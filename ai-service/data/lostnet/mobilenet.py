"""MobileNetV2 with CBAM attention for TraceMate's 10-class LostNet model."""

import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import torch
from torch import nn
from torch.hub import load_state_dict_from_url


class CBAM(nn.Module):
    """Convolutional Block Attention Module."""

    def __init__(self, in_channel):
        super(CBAM, self).__init__()
        self.Cam = ChannelAttentionModul(in_channel=in_channel)
        self.Sam = SpatialAttentionModul(in_channel=in_channel)

    def forward(self, x):
        x = self.Cam(x)
        x = self.Sam(x)
        return x


class ChannelAttentionModul(nn.Module):
    """Channel attention using adaptive max and average pooling."""

    def __init__(self, in_channel, r=0.5):
        super(ChannelAttentionModul, self).__init__()

        hidden_channels = int(in_channel * r)

        self.MaxPool = nn.AdaptiveMaxPool2d(1)
        self.fc_MaxPool = nn.Sequential(
            nn.Linear(in_channel, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, in_channel),
            nn.Sigmoid(),
        )

        self.AvgPool = nn.AdaptiveAvgPool2d(1)
        self.fc_AvgPool = nn.Sequential(
            nn.Linear(in_channel, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, in_channel),
            nn.Sigmoid(),
        )

        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        max_branch = self.MaxPool(x)
        max_in = max_branch.view(max_branch.size(0), -1)
        max_weight = self.fc_MaxPool(max_in)

        avg_branch = self.AvgPool(x)
        avg_in = avg_branch.view(avg_branch.size(0), -1)
        avg_weight = self.fc_AvgPool(avg_in)

        weight = self.sigmoid(max_weight + avg_weight)

        batch_size, channels = weight.shape
        channel_attention = torch.reshape(
            weight, (batch_size, channels, 1, 1)
        )

        return channel_attention * x


class SpatialAttentionModul(nn.Module):
    """Spatial attention using channel-wise maximum and mean features."""

    def __init__(self, in_channel):
        super(SpatialAttentionModul, self).__init__()

        self.conv = nn.Conv2d(
            2,
            1,
            kernel_size=7,
            padding=3,
        )
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        max_pool = torch.max(x, dim=1).values
        avg_pool = torch.mean(x, dim=1)

        max_pool = torch.unsqueeze(max_pool, dim=1)
        avg_pool = torch.unsqueeze(avg_pool, dim=1)

        x_cat = torch.cat((max_pool, avg_pool), dim=1)

        spatial_attention = self.sigmoid(self.conv(x_cat))

        return spatial_attention * x


__all__ = ["MobileNetV2", "mobilenet_v2"]

model_urls = {
    "mobilenet_v2": (
        "https://download.pytorch.org/models/"
        "mobilenet_v2-b0353104.pth"
    ),
}


def _make_divisible(v, divisor, min_value=None):
    """Make a channel count divisible by divisor."""

    if min_value is None:
        min_value = divisor

    new_v = max(
        min_value,
        int(v + divisor / 2) // divisor * divisor,
    )

    if new_v < 0.9 * v:
        new_v += divisor

    return new_v


class ConvBNReLU(nn.Sequential):
    """Convolution followed by batch normalization and ReLU6."""

    def __init__(
        self,
        in_planes,
        out_planes,
        kernel_size=3,
        stride=1,
        groups=1,
    ):
        padding = (kernel_size - 1) // 2

        super(ConvBNReLU, self).__init__(
            nn.Conv2d(
                in_planes,
                out_planes,
                kernel_size,
                stride,
                padding,
                groups=groups,
                bias=False,
            ),
            nn.BatchNorm2d(out_planes),
            nn.ReLU6(inplace=True),
        )


class InvertedResidual(nn.Module):
    """MobileNetV2 inverted residual block."""

    def __init__(self, inp, oup, stride, expand_ratio):
        super(InvertedResidual, self).__init__()

        self.stride = stride

        if stride not in (1, 2):
            raise ValueError("stride must be 1 or 2")

        hidden_dim = int(round(inp * expand_ratio))

        self.use_res_connect = (
            self.stride == 1 and inp == oup
        )

        layers = []

        if expand_ratio != 1:
            layers.append(
                ConvBNReLU(
                    inp,
                    hidden_dim,
                    kernel_size=1,
                )
            )

        layers.extend(
            [
                ConvBNReLU(
                    hidden_dim,
                    hidden_dim,
                    stride=stride,
                    groups=hidden_dim,
                ),
                nn.Conv2d(
                    hidden_dim,
                    oup,
                    kernel_size=1,
                    stride=1,
                    padding=0,
                    bias=False,
                ),
                nn.BatchNorm2d(oup),
            ]
        )

        self.conv = nn.Sequential(*layers)

    def forward(self, x):
        if self.use_res_connect:
            return x + self.conv(x)

        return self.conv(x)


class MobileNetV2(nn.Module):
    """MobileNetV2 classifier with a 3-channel CBAM input module."""

    def __init__(
        self,
        num_classes=1000,
        width_mult=1.0,
        inverted_residual_setting=None,
        round_nearest=8,
    ):
        super(MobileNetV2, self).__init__()

        block = InvertedResidual

        input_channel = 32
        last_channel = 1280

        if inverted_residual_setting is None:
            inverted_residual_setting = [
                # Expansion ratio, channels, repeats, first stride
                [1, 16, 1, 1],
                [6, 24, 2, 2],
                [6, 32, 3, 2],
                [6, 64, 4, 2],
                [6, 96, 3, 1],
                [6, 160, 3, 2],
                [6, 320, 1, 1],
            ]

        if (
            not inverted_residual_setting
            or len(inverted_residual_setting[0]) != 4
        ):
            raise ValueError(
                "inverted_residual_setting must be non-empty "
                "and contain 4 values per entry"
            )

        input_channel = _make_divisible(
            input_channel * width_mult,
            round_nearest,
        )

        self.last_channel = _make_divisible(
            last_channel * max(1.0, width_mult),
            round_nearest,
        )

        # Attention module for RGB input.
        self.cbam = CBAM(in_channel=3)

        features = [
            ConvBNReLU(
                3,
                input_channel,
                stride=2,
            )
        ]

        # Build every repeated inverted residual block.
        for t, c, n, s in inverted_residual_setting:
            output_channel = _make_divisible(
                c * width_mult,
                round_nearest,
            )

            for i in range(n):
                stride = s if i == 0 else 1

                features.append(
                    block(
                        input_channel,
                        output_channel,
                        stride,
                        expand_ratio=t,
                    )
                )

                input_channel = output_channel

        features.append(
            ConvBNReLU(
                input_channel,
                self.last_channel,
                kernel_size=1,
            )
        )

        self.features = nn.Sequential(*features)

        self.classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(
                self.last_channel,
                num_classes,
            ),
        )

        # Initialize model parameters.
        for module in self.modules():
            if isinstance(module, nn.Conv2d):
                nn.init.kaiming_normal_(
                    module.weight,
                    mode="fan_out",
                )

                if module.bias is not None:
                    nn.init.zeros_(module.bias)

            elif isinstance(module, nn.BatchNorm2d):
                nn.init.ones_(module.weight)
                nn.init.zeros_(module.bias)

            elif isinstance(module, nn.Linear):
                nn.init.normal_(
                    module.weight,
                    0,
                    0.01,
                )
                nn.init.zeros_(module.bias)

    def forward(self, x):
        x = self.cbam(x)
        x = self.features(x)
        x = x.mean([2, 3])
        x = self.classifier(x)

        return x

    def freeze_backbone(self):
        """Freeze the feature extractor during training."""

        for parameter in self.features.parameters():
            parameter.requires_grad = False

    def Unfreeze_backbone(self):
        """Unfreeze the feature extractor during training."""

        for parameter in self.features.parameters():
            parameter.requires_grad = True


def mobilenet_v2(
    pretrained=False,
    progress=True,
    num_classes=1000,
):
    """Create MobileNetV2 with an optional ImageNet pretrained model."""

    model = MobileNetV2(num_classes=1000)

    if pretrained:
        state_dict = load_state_dict_from_url(
            model_urls["mobilenet_v2"],
            model_dir="./model_data",
            progress=progress,
        )

        model.load_state_dict(state_dict)

    if num_classes != 1000:
        model.classifier = nn.Sequential(
            nn.Dropout(0.2),
            nn.Linear(
                model.last_channel,
                num_classes,
            ),
        )

    return model


if __name__ == "__main__":
    model = MobileNetV2(num_classes=10)

    print(model)

    sample = torch.randn(1, 3, 224, 224)

    with torch.no_grad():
        output = model(sample)

    print("Input shape:", sample.shape)
    print("Output shape:", output.shape)