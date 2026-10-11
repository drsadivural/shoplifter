#!/usr/bin/env python3
import hashlib,json,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1]
screens=json.loads((R/'design/screens.json').read_text())
missing=[];expected=[]
for s in screens:
 for lang in ['en','ja']:
  for theme in ['light','dark']:
   p=R/f"mockups/{s['platform']}/{lang}/{theme}/{s['id']}-{s['key']}.png"
   expected.append(p)
   if not p.is_file() or not p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):missing.append(str(p.relative_to(R)))
for p in ['README.md','START_HERE.md','CLAUDE.md','CLAUDE_CODE_JOB.md','reference/server.py','reference/domain.py','ios/RetailGuardApp.swift','edge/discover.py','docs/SCREEN_SPEC.md','contracts/schema.sql']:
 if not(R/p).is_file():missing.append(p)
for p in R.rglob('*.json'):json.loads(p.read_text())
if len({s['id'] for s in screens})!=len(screens):missing.append('duplicate_screen_ids')
print(json.dumps({'screens':len(screens),'expected_mockups':len(expected),'missing':missing},indent=2))
sys.exit(bool(missing))
