import sys
import os
from rembg import remove
from PIL import Image

def process_image(input_path, output_path):
    print(f"Processing: {input_path}")
    try:
        input_img = Image.open(input_path)
        output_img = remove(input_img)
        output_img.save(output_path, "PNG")
        print(f" -> Successfully saved transparent PNG: {output_path}")
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        for arg_path in sys.argv[1:]:
            if os.path.exists(arg_path):
                process_image(arg_path, arg_path)
        sys.exit(0)
