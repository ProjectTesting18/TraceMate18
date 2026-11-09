import unittest
import numpy as np
from PIL import Image
from services.visual_details import _scratch_like_screening, extract_visual_details

class ScratchScreeningTests(unittest.TestCase):
    def test_uniform_surface_does_not_flag_scratch(self):
        gray = np.full((128, 128), 180, dtype=np.uint8)
        result = _scratch_like_screening(gray)
        self.assertTrue(result['available'])
        self.assertFalse(result['possible_mark'])

    def test_long_contrasting_line_is_flagged_as_possible_mark(self):
        gray = np.full((128, 128), 180, dtype=np.uint8)
        gray[64, 12:116] = 35
        result = _scratch_like_screening(gray)
        self.assertTrue(result['possible_mark'])
        self.assertEqual(result['confidence'], 'low')

    def test_visual_details_exposes_screening_result(self):
        image = Image.new('RGB', (128, 128), (180, 180, 180))
        result = extract_visual_details(image_bytes=_image_bytes(image))
        self.assertIn('scratchScreening', result)
        self.assertTrue(result['scratchScreening']['available'])

    def test_foreground_colour_detects_black_and_white_objects_separately_from_background(self):
        black_item = Image.new('RGB', (128, 128), (245, 245, 245))
        from PIL import ImageDraw
        ImageDraw.Draw(black_item).rounded_rectangle((30, 28, 98, 100), radius=8, fill=(12, 12, 12))

        white_item = Image.new('RGB', (128, 128), (12, 12, 12))
        ImageDraw.Draw(white_item).rounded_rectangle((30, 28, 98, 100), radius=8, fill=(245, 245, 245))

        black_result = extract_visual_details(image_bytes=_image_bytes(black_item))
        white_result = extract_visual_details(image_bytes=_image_bytes(white_item))

        self.assertEqual(black_result['foreground_color']['label'], 'black')
        self.assertEqual(white_result['foreground_color']['label'], 'white')
        self.assertGreaterEqual(black_result['foreground_color']['confidence'], 0.65)
        self.assertGreaterEqual(white_result['foreground_color']['confidence'], 0.65)

def _image_bytes(image):
    from io import BytesIO
    output = BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()

if __name__ == '__main__':
    unittest.main()
