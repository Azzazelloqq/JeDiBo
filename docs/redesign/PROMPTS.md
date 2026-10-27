# Готовые промпты для агентов

Оба агента работают в своих ветках/worktree от `main` с закоммиченной папкой `docs/redesign/`.

## Агент A — переработка текущего визуала

```
Проект JeDiBo (TypeScript + Vite, не Unity). Выполни задачу A из docs/redesign/TASK-A-redesign.md.
Перед началом прочитай docs/redesign/README.md целиком и загрузи скиллы jedibo-ui и jedibo-pixel-art.
Главное: брутализм остаётся, «хоррор» уходит; новый логотип из docs/redesign/refs/02-logo-guide.png
с сохранением оригинальной формы; текущий подход к пиксель-арту сохраняется; механику не трогать.
Трогай только файлы, закреплённые за A в README §5. Проверяй каждую часть в браузере (скилл jedibo-ui).
В конце: скриншоты до/после в docs/redesign/result/A/ и docs/redesign/HANDOFF.md для агента B.
```

## Агент B — свитчер и варианты экранов

```
Проект JeDiBo (TypeScript + Vite, не Unity). Выполни задачу B из docs/redesign/TASK-B-variants.md.
Перед началом прочитай docs/redesign/README.md целиком и загрузи скиллы jedibo-ui и jedibo-pixel-art.
Этапы B1–B4 делай сразу, не трогая файлы агента A (README §5). Этапы B5–B8 — после того, как ветка
задачи A влита в main (подтяни её и прочитай docs/redesign/HANDOFF.md). Текущий подход к пиксель-арту
сохраняется, механику не трогать. Проверяй всё в браузере (скилл jedibo-ui).
В конце: скриншоты всех вариантов в docs/redesign/result/B/.
```
