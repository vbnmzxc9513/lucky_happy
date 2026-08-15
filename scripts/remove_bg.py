import os
import sys
from PIL import Image

def remove_background_and_circle(img_path, output_path=None):
    if output_path is None:
        output_path = img_path

    print(f"Processing: {img_path}")
    try:
        img = Image.open(img_path).convert("RGBA")
    except Exception as e:
        print(f"Error opening {img_path}: {e}")
        return False

    width, height = img.size
    pixels = img.load()

    # 1. Flood fill from top/left/right/bottom border edge pixels
    # We use BFS starting from edge pixels that are very close to pure white (background)
    visited = [[False] * height for _ in range(width)]
    queue = []

    threshold = 238  # Only near-white background (238~255) is flooded, protecting character white body
    for x in range(width):
        for y in [0, height - 1]:
            r, g, b, a = pixels[x, y]
            if r >= threshold and g >= threshold and b >= threshold:
                queue.append((x, y))
                visited[x][y] = True
                pixels[x, y] = (255, 255, 255, 0)

    for y in range(height):
        for x in [0, width - 1]:
            if not visited[x][y]:
                r, g, b, a = pixels[x, y]
                if r >= threshold and g >= threshold and b >= threshold:
                    queue.append((x, y))
                    visited[x][y] = True
                    pixels[x, y] = (255, 255, 255, 0)

    # BFS flood fill
    dx = [-1, 1, 0, 0]
    dy = [0, 0, -1, 1]
    while queue:
        cx, cy = queue.pop(0)
        for i in range(4):
            nx, ny = cx + dx[i], cy + dy[i]
            if 0 <= nx < width and 0 <= ny < height and not visited[nx][ny]:
                r, g, b, a = pixels[nx, ny]
                if r >= threshold and g >= threshold and b >= threshold:
                    visited[nx][ny] = True
                    pixels[nx, ny] = (255, 255, 255, 0)
                    queue.append((nx, ny))

    # 2. Check and remove extreme corners if any
    center_x, center_y = width / 2.0, height / 2.0
    for x in range(width):
        for y in range(height):
            dist = ((x - center_x) ** 2 + (y - center_y) ** 2) ** 0.5
            if dist > min(width, height) * 0.495:
                # Only remove extreme corner artifacts that are touching the edge circle
                pixels[x, y] = (0, 0, 0, 0)

    img.save(output_path, "PNG")
    print(f" -> Successfully saved transparent PNG: {output_path}")
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        for arg_path in sys.argv[1:]:
            if os.path.exists(arg_path):
                remove_background_and_circle(arg_path, arg_path)
        sys.exit(0)

    base_dir = r"d:\AI_Project\Lucky_horse"
    host_assets_dir = os.path.join(base_dir, "host", "assets")

    image_names = [
        "xiao_nie_front.png",
        "a_ping_front.png",
        "xiao_nie_cheer_1.png",
        "xiao_nie_cheer_2.png",
        "a_ping_cheer_1.png",
        "a_ping_cheer_2.png",
        "a_ping_cheer_halfbody.png",
        "xiao_nie_run.png",
        "a_ping_rule_explain.png",
        "xiao_nie_rule_explain.png"
    ]

    for name in image_names:
        p1 = os.path.join(base_dir, name)
        if os.path.exists(p1):
            remove_background_and_circle(p1, p1)
        
        p2 = os.path.join(host_assets_dir, name)
        if os.path.exists(p2):
            remove_background_and_circle(p2, p2)

    print("All specified character PNGs processed successfully!")
