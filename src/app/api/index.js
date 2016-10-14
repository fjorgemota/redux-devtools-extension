import jsan from 'jsan';

const listeners = {};
export const source = '@devtools-page';
let isCircular;

export default function stringify(obj, replacer, type) {
  if (type === 2) { // Deep serialization
    return jsan.stringify(obj, function(key, value) {
      if (value && value.toJS) { return value.toJS(); }
      return value;
    }, null, true);
  }
  return jsan.stringify(obj, replacer);
}

export function generateId(instanceId) {
  return instanceId || Math.random().toString(36).substr(2);
}

function tryCatch(fn, args) {
  try {
    return fn(args);
  } catch (err) {
    isCircular = true;
    toContentScript(args);
  }
}

function post(message) {
  window.postMessage(message, '*');
}

export function toContentScript(message, shouldStringify, serializeState, serializeAction) {
  if (shouldStringify || isCircular) {
    if (message.type !== 'ERROR' && message.type !== 'GET_REPORT' && message.payload) {
      message.payload = stringify(message.payload, serializeState);
    }
    if (message.type !== 'STATE' && message.action) {
      message.action = stringify(message.action, serializeAction);
    }
    post(message);
  } else {
    tryCatch(post, message);
  }
}

export function sendMessage(action, state, shouldStringify, id, name) {
  const message = {
    payload: state,
    source,
    name: name || '',
    instanceId: id
  };
  if (action) {
    message.type = 'ACTION';
    message.action = action.action ? action :
      { action: typeof action === 'object' ? action : { type: action } };
  } else {
    message.type = 'STATE';
  }

  toContentScript(message, shouldStringify);
}

function handleMessages(event) {
  if (process.env.BABEL_ENV !== 'test' && (!event || event.source !== window)) return;
  const message = event.data;
  if (!message || message.source !== '@devtools-extension') return;
  Object.keys(listeners).forEach(id => {
    if (message.id && id !== message.id) return;
    if (typeof listeners[id] === 'function') listeners[id](message);
    else listeners[id].forEach(fn => { fn(message); });
  });
}

export function setListener(onMessage, instanceId) {
  listeners[instanceId] = onMessage;
  window.addEventListener('message', handleMessages, false);
}

export function disconnect() {
  window.removeEventListener('message', handleMessages);
  toContentScript({ type: 'DISCONNECT', source });
}

export function connect(config = {}) {
  const id = generateId(config.instanceId);
  const name = config.name || document.title || id;

  const subscribe = (listener) => {
    if (!listener) return undefined;
    if (!listeners[id]) listeners[id] = [];
    listeners[id].push(listener);

    return function unsubscribe() {
      const index = listeners.indexOf(listener);
      listeners[id].splice(index, 1);
    };
  };

  const unsubscribe = (instanceId) => {
    delete listeners[instanceId];
  };

  const send = (action, state) => {
    sendMessage(action, state, config.shouldStringify, id, name);
  };

  const init = (state, action) => {
    toContentScript(
      {
        type: 'INIT', payload: state,
        action: action || {},
        instanceId: id, name, source
      },
      config.shouldStringify
    );
  };

  const error = (payload) => {
    post({ type: 'ERROR', payload, id, source });
  };

  window.addEventListener('message', handleMessages, false);

  toContentScript({ type: 'INIT_INSTANCE', instanceId: id, source});

  return {
    init,
    subscribe,
    unsubscribe,
    send,
    error
  };
}

export function updateStore(stores) {
  return function(newStore, instanceId) {
    const store = stores[instanceId || Object.keys(stores)[0]];
    // Mutate the store in order to keep the reference
    store.liftedStore = newStore.liftedStore;
    store.getState = newStore.getState;
    store.dispatch = newStore.dispatch;
  };
}