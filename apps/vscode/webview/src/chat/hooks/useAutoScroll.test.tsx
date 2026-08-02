import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoScroll } from "./useAutoScroll.js";

/** jsdom has no `scrollTo`; mirror how real browsers move `scrollTop` from it. */
function stubScrollTo(el: HTMLDivElement): void {
  el.scrollTo = ((opts?: ScrollToOptions) => {
    if (opts && typeof opts.top === "number") el.scrollTop = opts.top;
  }) as typeof el.scrollTo;
}

/** Give a jsdom div the scroll metrics real browsers compute from layout. */
function makeScrollable(el: HTMLDivElement, { scrollHeight = 0, clientHeight = 100, scrollTop = 0 } = {}): void {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
}

type ObserverCb = ResizeObserverCallback;
let observerCallback: ObserverCb | null = null;

class ResizeObserverStub {
  constructor(cb: ObserverCb) {
    observerCallback = cb;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fireResize(): void {
  observerCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
}

let container: HTMLDivElement;
let root: Root;
let logEl: HTMLDivElement | null = null;
let contentEl: HTMLDivElement | null = null;
let latestApi: ReturnType<typeof useAutoScroll> | null = null;

function Harness() {
  const api = useAutoScroll();
  latestApi = api;
  return (
    <div
      ref={(el) => {
        if (el) stubScrollTo(el);
        api.logRef.current = el;
        logEl = el;
      }}
    >
      <div
        ref={(el) => {
          api.contentRef.current = el;
          contentEl = el;
        }}
      />
    </div>
  );
}

function renderHarness(): void {
  act(() => {
    root.render(<Harness />);
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  observerCallback = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  logEl = null;
  contentEl = null;
  latestApi = null;
  observerCallback = null;
  vi.unstubAllGlobals();
});

describe("useAutoScroll", () => {
  it("scrolls to the bottom when content grows while sticking", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 200, clientHeight: 100, scrollTop: 0 });

    act(() => {
      fireResize();
    });

    expect(logEl!.scrollTop).toBe(200);
    expect(latestApi!.stuck).toBe(true);
  });

  it("does not unstick when a programmatic scroll event arrives after content grew", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 200, clientHeight: 100, scrollTop: 200 });

    act(() => {
      fireResize();
    });

    // Content grew after scrollTo was issued; the delayed scroll event would
    // see a large distance from the bottom if we trusted it for stick state.
    Object.defineProperty(logEl!, "scrollHeight", { value: 500, configurable: true });
    act(() => {
      logEl!.dispatchEvent(new Event("scroll"));
    });

    Object.defineProperty(logEl!, "scrollHeight", { value: 600, configurable: true });
    act(() => {
      fireResize();
    });

    expect(logEl!.scrollTop).toBe(600);
    expect(latestApi!.stuck).toBe(true);
  });

  it("cuts following on an upward wheel", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 500, clientHeight: 100, scrollTop: 400 });

    act(() => {
      logEl!.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
    });

    expect(latestApi!.stuck).toBe(false);

    Object.defineProperty(logEl!, "scrollHeight", { value: 700, configurable: true });
    act(() => {
      fireResize();
    });

    expect(logEl!.scrollTop).toBe(400);
    expect(latestApi!.hasNewContent).toBe(true);
  });

  it("does not cut following on a downward wheel", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 500, clientHeight: 100, scrollTop: 400 });

    act(() => {
      logEl!.dispatchEvent(new WheelEvent("wheel", { deltaY: 50 }));
    });

    Object.defineProperty(logEl!, "scrollHeight", { value: 700, configurable: true });
    act(() => {
      fireResize();
    });

    expect(logEl!.scrollTop).toBe(700);
    expect(latestApi!.stuck).toBe(true);
  });

  it("cuts following on PageUp", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 500, clientHeight: 100, scrollTop: 400 });

    act(() => {
      logEl!.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    });

    expect(latestApi!.stuck).toBe(false);
  });

  it("resumes sticking after scrolling near the bottom", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 500, clientHeight: 100, scrollTop: 0 });

    act(() => {
      logEl!.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
    });
    expect(latestApi!.stuck).toBe(false);

    logEl!.scrollTop = 450;
    act(() => {
      logEl!.dispatchEvent(new Event("scroll"));
    });

    expect(latestApi!.stuck).toBe(true);
    expect(latestApi!.hasNewContent).toBe(false);
  });

  it("resumes sticking after stickToBottom(), scrolling on the next resize", () => {
    renderHarness();
    makeScrollable(logEl!, { scrollHeight: 500, clientHeight: 100, scrollTop: 0 });

    act(() => {
      logEl!.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
    });

    act(() => {
      latestApi!.stickToBottom();
    });

    Object.defineProperty(logEl!, "scrollHeight", { value: 800, configurable: true });
    act(() => {
      fireResize();
    });

    expect(logEl!.scrollTop).toBe(800);
    expect(latestApi!.stuck).toBe(true);
  });

  it("exposes contentRef for the ResizeObserver target", () => {
    renderHarness();
    expect(contentEl).not.toBeNull();
    expect(latestApi!.contentRef.current).toBe(contentEl);
  });
});
