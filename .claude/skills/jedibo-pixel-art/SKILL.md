---
name: jedibo-pixel-art
description: Rules of JeDiBo's procedural pixel-art approach (low-res canvas, integer scaling, palette-only colors, ASCII sprites). Load before drawing any sprite, icon, card face, logo mark, emblem, background or effect.
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

## Логотип

Исключение из правил выше: надпись и знак логотипа — векторные (SVG), оригинальные пропорции, без пикселизации. Пиксельная версия делается только для знака в мелких размерах (≤ 48 px) — ASCII-маска на сетке модуля знака. Подробно — `docs/redesign/README.md` §4.
