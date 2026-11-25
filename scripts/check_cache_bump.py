"""檢查兩個 Git 版本之間快取外殼變更時是否更換快取名稱。"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
base = sys.argv[1] if len(sys.argv) > 1 else 'origin/main'
head = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'

def git(*args):
    result = subprocess.run(['git', *args], cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        sys.exit(f"Git 讀取失敗：{result.stderr.strip()}")
    return result.stdout

def shell(ref):
    source = git('show', f'{ref}:sw.js')
    name = re.search(r"CACHE_NAME\s*=\s*['\"]([^'\"]+)", source)
    items = re.search(r'const SHELL\s*=\s*\[(.*?)\]', source, re.S)
    if not name or not items:
        sys.exit(f'{ref} 的 sw.js 格式無法辨識')
    paths = {x.removeprefix('./') for x in re.findall(r"['\"]([^'\"]+)['\"]", items.group(1))}
    paths.discard('')
    return name.group(1), paths

before, old_paths = shell(base)
after, new_paths = shell(head)
changed = set(git('diff', '--name-only', base, head).splitlines())
affected = sorted(changed & (old_paths | new_paths))
if (affected or old_paths != new_paths) and before == after:
    print('快取外殼已變更，但 CACHE_NAME 未更新：' + ', '.join(affected))
    sys.exit(1)
print(f'快取版本 {before} → {after}；外殼變更 {len(affected)} 個檔案。')
