"""Refresh bundled OFL font subsets after editing Chinese interface text."""
from pathlib import Path
import re
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parents[1]
source = ''.join(path.read_text() for path in (root / 'src').glob('*') if path.suffix in ('.js', '.css'))
source += (root / 'index.html').read_text()
characters = ''.join(sorted(set(re.findall(r'[^\x00-\x7f]', source))))
for family, filename in [('Noto Sans SC', 'noto-sans-sc.ttf'), ('Noto Serif SC', 'noto-serif-sc.ttf')]:
    url = 'https://fonts.googleapis.com/css2?family=' + urllib.parse.quote(family) + ':wght@400&text=' + urllib.parse.quote(characters)
    with urllib.request.urlopen(url, timeout=30) as response:
        css = response.read().decode()
    font_url = re.search(r'url\(([^)]+)\)', css).group(1)
    with urllib.request.urlopen(font_url, timeout=30) as response:
        data = response.read()
    (root / 'public' / filename).write_bytes(data)
    print(f'{filename}: {len(characters)} interface characters, {len(data)} bytes')
