// Inspired by react-hot-toast library
import { useState, useEffect, createContext, useContext } from "react";

// Stacking is capped so a burst of actions can never fill the screen. A
// single success toast replaces any existing success toast (it never stacks
// with another success). Errors may still stack a little but auto-dismiss
// slower and keep their dismiss button.
const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 500;
const TOAST_SUCCESS_DURATION = 2200;
const TOAST_ERROR_DURATION = 6000;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();

const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const clearFromRemoveQueue = (toastId) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

// Auto-dismiss timer (separate from the remove queue, which only handles the
// exit-animation delay after a toast is already closed).
const autoDismissTimeouts = new Map();

const scheduleAutoDismiss = (toastId, duration) => {
  clearAutoDismiss(toastId);
  const timeout = setTimeout(() => {
    autoDismissTimeouts.delete(toastId);
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
  }, duration);
  autoDismissTimeouts.set(toastId, timeout);
};

const clearAutoDismiss = (toastId) => {
  const t = autoDismissTimeouts.get(toastId);
  if (t) {
    clearTimeout(t);
    autoDismissTimeouts.delete(toastId);
  }
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        // Non-destructive (success) toasts replace existing non-destructive
        // toasts so only one success toast is ever visible. Destructive
        // (error) toasts stack up to TOAST_LIMIT so the user can read each.
        toasts:
          action.toast.variant === "destructive"
            ? [action.toast, ...state.toasts].slice(0, TOAST_LIMIT)
            : [
                action.toast,
                ...state.toasts.filter((t) => t.variant === "destructive"),
              ].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      // ! Side effects !
      if (toastId) {
        clearAutoDismiss(toastId);
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          clearAutoDismiss(toast.id);
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        autoDismissTimeouts.forEach((_, id) => clearAutoDismiss(id));
        return {
          ...state,
          toasts: [],
        };
      }
      clearAutoDismiss(action.toastId);
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = [];

let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

function toast({ ...props }) {
  const id = genId();
  const variant = props.variant || "default";
  const duration =
    props.duration ??
    (variant === "destructive" ? TOAST_ERROR_DURATION : TOAST_SUCCESS_DURATION);

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  const dismiss = () =>
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      variant,
      duration,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  scheduleAutoDismiss(id, duration);

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId) => dispatch({ type: actionTypes.DISMISS_TOAST, toastId }),
  };
}

export { useToast, toast };