import sys,os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, sys.argv[3])
from PIL import Image
M={'Блицкриг':'blitzkrieg','Депрессия':'depression','Карьерный лифт вверх':'careerUp','Карьерный лифт вниз':'careerDown','Круговая защита':'roundProtection','Отступление':'retreat','Подарок':'gift','Пропуск хода':'skipMove','Смена поля':'sideChange','Шпион':'spy','бессмертие':'immortal','воскрешение':'resurrection','двойная смерть врага':'doubleDeathEnemy','двойная смерть':'doubleDeath','девальвация':'devaluation','защитный барьер':'barrier','линия смерти':'deathLine','предательство':'betrayal','прыгун':'jumper','свежая кровь':'freshBlood','тихоход':'snail'}
for f in os.listdir(sys.argv[1]):
  n=f[:-4]
  im=Image.open(os.path.join(sys.argv[1],f)).convert('RGB').resize((512,768),Image.Resampling.LANCZOS)
  im.save(os.path.join(sys.argv[2],M[n]+'.jpg'),quality=90); print(n,'->',M[n])
