---
name: jedibo-pixel-art
description: Rules of JeDiBo's procedural pixel-art approach (low-res canvas, integer scaling, palette-only colors, ASCII sprites) and the pipeline for turning the Karma card illustrations into pixel art. Load before drawing any sprite, icon, card face, logo mark, emblem, background or effect, or before running/editing the card pixelization script.
---

# Пиксель-арт JeDiBo

Владелец просил **сохранить текущий подход**. Это обязательные правила.

## Принципы

1. **Рисуем кодом в низком разрешении.** Спрайт = маленький canvas (`makeCanvas(w, h)` из `src/render/pixel.ts`), затем целочисленный масштаб (`scaleCanvas`, `canvasEl(c, scale)`), `image-rendering: pixelated`. Никаких дробных масштабов, сглаживания, `filter: blur`, мягких радиальных градиентов поверх пикселей.
2. **Только палитра** `src/render/palette.ts` (`PAL`, `STONE`). Новый цвет — сначала в палитру, с ролью и комментарием.
3. **Свет слева-сверху.** Светлая фаска сверху/слева, тёмная снизу/справа, «толщина» вниз 2–3 px (см. `pieceSprite`, `cardFace`).
4. **Контур** тёмным цветом палитры (`outline(src, color)`), у мелких иконок — автоматически.
5. **Фактура бетона** — `concreteTile(w, h, rgb, seed, { pores, seams, amp })`; сид детерминированный (от id), чтобы картинка не «прыгала» между перерисовками.
6. **Иконки** — ASCII-матрицы (см. `ICONS` в `src/render/cardArt.ts`, ключи цветов `K`), собираются `fromAscii`, композиция — `compose`. Эмблемы Летописи делаются так же (16×16).
7. **Анимации** — по целым пикселям исходного разрешения или ступенчато (`steps()`), «сок» из `src/render/fx.ts` и `tween.ts`. Уважать `prefers-reduced-motion` и настройки (`shake`, `animSpeed`).
8. **Кэшировать** сгенерированные канвасы (`faceCache` и т.п.), клонировать при вставке в DOM.
9. CSS-эффекты поверх пикселей (блики, подсветки) квантовать на сетку: шаг градиентов/масок = `calc(var(--s) * 1px)`, где `--s` — масштаб элемента.

## Иллюстрации Карт Кармы → пиксель-арт

Это единственные растровые исходники (рисованные иллюстрации). Переводим их в пиксели **один раз скриптом**, результат коммитим.

- Исходники: `docs/redesign/assets/card-illustrations/<cardId>.jpg` (512×768, имена = `CardId`). Оригиналы 2560×3840 у владельца (путь в `docs/redesign/README.md`).
- Проба: `docs/redesign/assets/card-pixel-test-40x60-48x72.png`, скрипт пробы `docs/redesign/assets/pixtest.py`: BOX-уменьшение до 48×72 → квантование к 10 цветам (графит ×2, бетон ×4, `bone`, оранжевые ×3) без дизеринга. Уже читается — от этого и отталкиваться.
- Шаги скрипта `scripts/pixelize-cards.*`:
  1. кадрирование по таблице `{ cardId: { cx, cy, zoom } }` — главный силуэт крупно, лишний фон отрезать;
  2. уменьшение BOX/area до целевого окна (ширина·высота окна иллюстрации карты, целые пиксели);
  3. лёгкое повышение контраста до квантования;
  4. квантование к палитре из `palette.ts` (8–12 цветов; бренд-оранжевый `#FF3600` обязателен). Дизеринг — нет или упорядоченный 2×2 только в полутонах;
  5. чистка: одиночные пиксели, отличающиеся от всех 4 соседей, заменить на преобладающий цвет соседей;
  6. опционально 1-px контур `ink` по краю тёмных силуэтов на светлом фоне;
  7. сохранить PNG `public/cards/pixel/<cardId>.png`.
- Python-вариант: Pillow ставится без влияния на систему — `python -m pip install --target <scratch>/pylib pillow`, запускать `python -I script.py …` с `sys.path.insert(0, pylib)`; в Windows-консоли `sys.stdout.reconfigure(encoding="utf-8")` (кириллица в именах). Node-вариант через `sharp` допустим как devDependency.
- Ручная доводка PNG разрешена; фиксируй, какие карты правились, в комментарии скрипта.

## Логотип

Исключение из правил выше: надпись и знак логотипа — векторные (SVG), оригинальные пропорции, без пикселизации. Пиксельная версия делается только для знака в мелких размерах (≤ 48 px) — ASCII-маска на сетке модуля знака. Подробно — `docs/redesign/README.md` §4.
