// Лобби сетевой игры: создать комнату / войти по коду, ожидание соперника, возврат после перезагрузки.
// Минимальный экран на текущих компонентах (этап 4 сети); финальный вид — после редизайна.
import type { GuestFailure, HostStatus } from '../../net/peer';
import type { TransportStatus } from '../../net/transport';
import { setMood } from '../../render/background';
import { endNet, hostNet, inviteLink, joinNet, netSession, normalizeCode, resumeNet, takeInviteCode, type NetSession } from '../../session/netSession';
import { go, type Screen } from '../app';
import { btn, h, toast } from '../dom';
import { gameScreen } from './game';
import { menuScreen } from './menu';

const FAIL_TEXT: Record<GuestFailure, string> = {
  notFound: 'Комната не найдена. Проверьте код — или хост закрыл вкладку.',
  ice: 'Не удалось соединиться напрямую: сеть одного из игроков не пропускает соединение. Попробуйте другую сеть (например, раздать интернет с телефона).',
  browser: 'Браузер не поддерживает WebRTC — откройте игру в свежем Chrome, Firefox или Safari.',
};

const HOST_STATUS: Record<HostStatus, string> = {
  connecting: 'Регистрируем комнату…',
  open: 'Комната открыта — ждём соперника',
  reconnecting: 'Нет связи с сервером знакомств, переподключаемся…',
  failed: 'Не удалось открыть комнату',
};

/** Экран, с которого начать после загрузки: вход по ссылке-приглашению или возврат в комнату после перезагрузки. */
export function bootScreen(): Screen | null {
  const invite = takeInviteCode();
  if (invite) {
    joinNet(invite);
    return lobbyScreen;
  }
  return resumeNet() ? lobbyScreen : null;
}

export function lobbyScreen(root: HTMLElement) {
  setMood('menu');
  let session: NetSession | null = netSession();
  let unlisten: (() => void) | null = null;
  let codeInput = '';
  let failure: string | null = null;

  /** Подписаться на сессию: как только комната прислала start — в партию. */
  function watch(s: NetSession) {
    unlisten?.();
    if (s.client.state) return enterGame(s);
    unlisten = s.client.listen({
      start: () => enterGame(s),
      opponent: () => render(),
      error: (code, text) => {
        if (code === 'version' || code === 'full') {
          failure = text;
          endNet(false);
          session = null;
          render();
        } else toast(text, 'red');
      },
    });
    if (s.room) s.room.onStatus = () => render();
    if (s.link)
      s.link.onStatus = (st: TransportStatus, why?: GuestFailure) => {
        if (st === 'failed') {
          failure = why ? FAIL_TEXT[why] : 'Не удалось подключиться';
          endNet(false);
          session = null;
        }
        render();
      };
  }

  function enterGame(s: NetSession) {
    unlisten?.();
    unlisten = null;
    go((r) => gameScreen(r, 'net', s));
  }

  function create() {
    failure = null;
    session = hostNet();
    watch(session);
    render();
  }

  function join() {
    const code = normalizeCode(codeInput);
    if (code.length !== 5) return toast('Код — 5 символов', 'red');
    failure = null;
    session = joinNet(code);
    watch(session);
    render();
  }

  function cancel() {
    endNet(true);
    session = null;
    render();
  }

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      toast('Ссылка скопирована', 'amber');
    } catch {
      toast(inviteLink(code), 'stone');
    }
  }

  function render() {
    let body: Node;
    if (!session) {
      const input = h('input', {
        class: 'code-input',
        maxLength: 5,
        placeholder: 'КОД',
        value: codeInput,
        autocomplete: 'off',
        spellcheck: false,
        oninput: (e: Event) => {
          const el = e.target as HTMLInputElement;
          el.value = codeInput = normalizeCode(el.value);
        },
        onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && join(),
      });
      body = h(
        'div',
        { class: 'lobby-grid' },
        h(
          'section',
          { class: 'slab lobby-card' },
          h('div', { class: 'h-label' }, 'Своя комната'),
          h('p', { class: 'muted' }, 'Вы получите код и ссылку для соперника. Игра идёт через ваш браузер — не закрывайте вкладку до конца партии.'),
          btn('Создать комнату', create, 'btn-red btn-big'),
        ),
        h(
          'section',
          { class: 'slab lobby-card' },
          h('div', { class: 'h-label' }, 'Войти по коду'),
          h('p', { class: 'muted' }, 'Введите код, который прислал соперник, или просто откройте его ссылку.'),
          input,
          btn('Войти', join, 'btn-amber btn-big'),
        ),
      );
    } else if (session.role === 'host') {
      const st = session.room!.status;
      const opp = session.client.opponent;
      body = h(
        'section',
        { class: 'slab lobby-card lobby-wait' },
        h('div', { class: 'h-label' }, 'Код комнаты'),
        h('div', { class: 'room-code' }, session.code),
        h('div', { class: 'row' }, btn('Скопировать ссылку', () => void copyLink(session!.code), 'btn-amber'), btn('Отмена', cancel, 'btn-dark')),
        h('p', { class: `lobby-status ${st === 'failed' ? 'bad' : ''}` }, opp ? `${opp.name} подключается…` : HOST_STATUS[st]),
        h('p', { class: 'muted small' }, 'Не закрывайте и не сворачивайте надолго эту вкладку: комната живёт в ней.'),
      );
    } else {
      body = h(
        'section',
        { class: 'slab lobby-card lobby-wait' },
        h('div', { class: 'h-label' }, 'Комната'),
        h('div', { class: 'room-code' }, session.code),
        h('p', { class: 'lobby-status' }, session.link?.status === 'open' ? 'Соединение есть, ждём начала…' : 'Подключаемся к хосту…'),
        h('div', { class: 'row' }, btn('Отмена', cancel, 'btn-dark')),
      );
    }
    root.replaceChildren(
      h(
        'div',
        { class: 'page narrow lobby' },
        h('div', { class: 'page-head' }, h('h1', {}, 'По сети'), h('div', { class: 'page-sub' }, 'дуэль · Классика'), btn('В меню', () => (cancel(), go(menuScreen)))),
        failure ? h('section', { class: 'slab lobby-fail' }, failure) : null,
        body,
      ),
    );
  }

  if (session) watch(session);
  render();
  return () => unlisten?.();
}
