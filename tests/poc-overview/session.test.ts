import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPocLogout, SessionBadge, observePocSession } from "../../components/poc-session-status";
let browser: EventTarget;
let page: EventTarget & { hidden: boolean };
let stop: (() => void) | undefined;
const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  browser = new EventTarget();
  page = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("window", browser); vi.stubGlobal("document", page);
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
it.each(["Finance", "Admin", "Technical (Management)"])("shows only the confirmed %s role", async role => {
  const fetcher = vi.fn().mockResolvedValue(response({active:true,role,userId:"PRIVATE_ID",organizationId:"PRIVATE_ORG"}));
  vi.stubGlobal("fetch", fetcher); const display=vi.fn(); stop=observePocSession(display);
  expect(display).toHaveBeenLastCalledWith("Checking session"); await settle();
  expect(display).toHaveBeenLastCalledWith(`Signed in · ${role}`);
  expect(JSON.stringify(display.mock.calls)).not.toContain("PRIVATE");
  expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
});
it.each([{active:false}, {active:true,role:"Unknown"}, null])("handles inactive and malformed response %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(data)));
  const display=vi.fn();stop=observePocSession(display); await settle();
  expect(display).toHaveBeenLastCalledWith(data?.active===false ? "Not signed in":"Session unavailable");
});
it.each([false,true])("reports request/service failure without claiming logout (%s)", async network => {
  vi.stubGlobal("fetch",network?vi.fn().mockRejectedValue(new Error("offline")):vi.fn().mockResolvedValue(response({},false)));
  const display=vi.fn();stop=observePocSession(display);await settle();expect(display).toHaveBeenLastCalledWith("Session unavailable");
});
it("clears expired status on revalidation and refreshes after returning",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({active:true,role:"Finance"})).mockResolvedValue(response({active:false}));vi.stubGlobal("fetch",fetcher);
 const display=vi.fn();stop=observePocSession(display);await settle();
 await vi.advanceTimersByTimeAsync(30000);expect(display).toHaveBeenLastCalledWith("Not signed in");
 browser.dispatchEvent(new Event("blur"));expect(display).toHaveBeenLastCalledWith("Checking session");
 browser.dispatchEvent(new Event("focus"));browser.dispatchEvent(new Event("pageshow"));await settle();expect(fetcher).toHaveBeenCalledTimes(3);
});
it("ignores late replies after leaving or cleanup; hides identity while hidden",async()=>{
 let resolve!: (value:unknown)=>void;
 vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;})));
 const display=vi.fn();stop=observePocSession(display);page.hidden=true;page.dispatchEvent(new Event("visibilitychange"));
 resolve(response({active:true,role:"Admin"}));await settle();expect(display).toHaveBeenLastCalledWith("Checking session");
 stop();stop=undefined;await vi.advanceTimersByTimeAsync(60000);expect(display).toHaveBeenCalledTimes(2);
});
it("times out a stalled session request",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(new Error("aborted"))))));
 const display=vi.fn();stop=observePocSession(display);await vi.advanceTimersByTimeAsync(8000);expect(display).toHaveBeenLastCalledWith("Session unavailable");
});

it("offers a native keyboard-accessible login link only when confirmed signed out", () => {
 vi.stubGlobal("React",React);
 const html=renderToStaticMarkup(React.createElement(SessionBadge,{status:"Not signed in"}));
 expect(html).toContain('href="/transactions"');expect(html).toContain('sign in to FinGence');expect(html).toContain('focus-visible:');
 for(const status of ["Checking session","Session unavailable","Signed in · Finance"] as const) expect(renderToStaticMarkup(React.createElement(SessionBadge,{status}))).not.toContain('<a ');
});
it("refreshes the role after a successful login on another page and returning home",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({active:false})).mockResolvedValue(response({active:true,role:"Finance"})));
 const display=vi.fn();stop=observePocSession(display);await settle();expect(display).toHaveBeenLastCalledWith("Not signed in");
 browser.dispatchEvent(new Event("blur"));browser.dispatchEvent(new Event("focus"));await settle();expect(display).toHaveBeenLastCalledWith("Signed in · Finance");
});

it("renders the confirmed role as an accessible expandable action",()=>{
 vi.stubGlobal("React",React);const html=renderToStaticMarkup(React.createElement(SessionBadge,{status:"Signed in · Admin",onToggle:()=>{},expanded:true}));expect(html).toContain('<button');expect(html).toContain('aria-expanded="true"');expect(html).toContain('Signed in · Admin');
});
it("coalesces logout requests and waits for explicit server confirmation",async()=>{
 let resolve!: (v:unknown)=>void;const fetcher=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r;}));vi.stubGlobal("fetch",fetcher);const logout=createPocLogout();const first=logout();expect(logout()).toBe(first);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].method).toBe("POST");resolve(response({active:false}));await expect(first).resolves.toBeUndefined();
});
it.each([response({active:true}),response({active:false},false)])("rejects unconfirmed logout",async result=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(result));await expect(createPocLogout()()).rejects.toThrow("LOGOUT_UNCONFIRMED");});
