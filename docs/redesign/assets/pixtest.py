import sys,os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, sys.argv[3])
from PIL import Image
src,dst=sys.argv[1],sys.argv[2]
pal=[(0x14,0x14,0x16),(0x30,0x30,0x35),(0x5f,0x5c,0x57),(0x91,0x8c,0x84),(0xc4,0xbf,0xb4),(0xe8,0xe3,0xd7),(0x7a,0x1a,0x08),(0xc2,0x2e,0x0c),(0xff,0x3d,0x0f),(0xff,0x8a,0x5c)]
p=Image.new('P',(1,1)); flat=[c for t in pal for c in t]; p.putpalette(flat+[0]*(768-len(flat)))
files=sorted(f for f in os.listdir(src) if f.endswith('.png'))[:7]
out=[]
for W,H in [(40,60),(48,72)]:
  row=[]
  for f in files:
    im=Image.open(os.path.join(src,f)).convert('RGB')
    s=im.resize((W,H),Image.Resampling.BOX)
    q=s.quantize(palette=p,dither=Image.Dither.NONE).convert('RGB')
    row.append(q.resize((W*5,H*5),Image.Resampling.NEAREST))
  out.append(row)
cw=48*5; sheet=Image.new('RGB',(cw*7,72*5*2+10),(40,40,40))
for r,row in enumerate(out):
  for i,t in enumerate(row): sheet.paste(t,(i*cw,r*(72*5+10)))
sheet.save(os.path.join(dst,'pixtest.png'))
