---
name: jedibo-ui
description: How JeDiBo's UI is built (TypeScript + Vite, plain DOM, no framework) and how to verify UI changes in the browser. Load before editing anything in src/ui, src/styles or src/render, or before building a new screen or a visual variant.
---

# JeDiBo UI — конвенции и проверка

Проект — TypeScript + Vite без фреймворков (папка называется UnityProjects, но Unity тут нет). Движок правил в `src/core` — UI его не меняет, только шлёт `Action` через `Match.submit`.

## Как устроены экраны

- Экран — функция `(root: HTMLElement) => (() => void) | void` (`src/ui/app.ts`). Переход: `go(screen)`; анимация входа/выхода уже в роутере (`.screen-enter/.screen-leave`). Возвращай cleanup, если вешаешь таймеры, `requestAnimationFrame`, слушатели на `window`/`document`.
- DOM строится хелпером `h(tag, props, ...children)` из `src/ui/dom.ts`: `class`, `style`, `onClick` → слушатель. Кнопки — только через `btn(label, onClick, cls)`: там звук наведения/клика и покачивание. Тосты — `toast(text, tone)`.
- Перерисовка — через `render()`, вызывающий `root.replaceChildren(...)` (см. `settings.ts`, `profile.ts`). Состояние держится в замыкании экрана.
- Настроение фона — `setMood('menu' | 'game' | 'karma' | 'win' | 'lose')` в начале экрана.
- Общие виджеты: `src/ui/widgets.ts` (фигуры, аватар, плитки меню, логотип), карта Кармы — `src/ui/card.ts` (`cardEl(id, { scale })`).
- Настройки и профиль: `getSettings/saveSettings`, `getProfile/saveProfile` (`src/profile/profile.ts`), применение — `applySettings()`.

## Стили

- Все цвета — CSS-переменные из `src/render/palette.ts` (`applyCssPalette` превращает `slab900` в `--slab-900`). **Не писать hex в CSS/TS**, кроме самой палитры; для варианта «б» — свои токены в `src/styles/variants/b.css` под `body.ui-b`.
- Шрифты: `--f-pix` (пиксельный, заголовки/кнопки), `--f-mono` (текст). Подключение — `index.html`.
- Тени жёсткие, без размытия (`0 5px 0 …`). Скругления — только в варианте «б».
- Фактуры бетона — `concreteCss()` из `render/sprites.ts`, генерируются в `main.ts` и кладутся в `--tex-*`.
- Канвасы и пиксельные картинки: класс `pix`, размер = исходный × целое (`canvasEl(c, scale)`).

## Варианты визуала (задача B)

- Реестр: `src/ui/variants/registry.ts` — `screen(id)` возвращает экран нужного варианта; не импортируй экраны напрямую для навигации.
- Код варианта: `src/ui/variants/<screen>/<a|b|c>.ts`; логику (данные, обработчики) делить, раскладку — разная.
- Каждый вариант обязан сохранять всю функциональность экрана.

## Проверка (обязательно после заметных изменений)

1. `npm run build` — typecheck + сборка без ошибок. Для движка: `npm run sim -- 50`.
2. Запуск в браузере: в `.claude/launch.json` есть конфигурация `jedibo-dev` (`npm run dev`, порт 5173) — `preview_start` с именем `jedibo-dev`.
3. Окно 1440×900 и 1920×1080 (`resize_window`), скриншоты каждого затронутого экрана. Скриншот может отставать на кадр от перехода — после `go()` подожди ~1 с.
4. Навигация из консоли: кнопки находятся по тексту, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Колода').click()`. В dev доступны `__match` и `__board`.
5. Пройти: меню → каждый экран → назад; партия против бота: расстановка пресетом, «Готово», пара ходов, оверлей Кармы (можно ускорить через `__match`), итог.
6. Консоль без ошибок (`read_console_messages`).
7. Скриншоты результатов — в `docs/redesign/result/<A|B>/`.
