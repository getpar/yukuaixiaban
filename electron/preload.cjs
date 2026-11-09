'use strict';

/**
 * 预加载脚本：只暴露白名单 API，渲染进程拿不到 Node。
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('xb', {
  // ---- 设置 ----
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // ---- 窗口 / 托盘 ----
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),
  setTrayTooltip: (text) => ipcRenderer.send('tray:set-tooltip', text),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  bossHide: () => ipcRenderer.send('window:boss-hide'),

  // ---- P2：开机自启 / 下班通知 ----
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', Boolean(enabled)),
  notifyDone: (payload) => ipcRenderer.invoke('notify:done', payload),

  // ---- P2：每日收入历史 ----
  loadHistory: () => ipcRenderer.invoke('history:load'),
  recordHistory: (entry) => ipcRenderer.invoke('history:record', entry),

  // ---- P2：自定义桌宠形象 ----
  pickCustomMascot: () => ipcRenderer.invoke('mascot:pick-custom'),
  clearCustomMascot: () => ipcRenderer.invoke('mascot:clear-custom'),
  customMascotUrl: () => ipcRenderer.invoke('mascot:custom-url'),

  // ---- P3：下班跑出桌面彩蛋 ----
  startDesktopRun: (payload) => ipcRenderer.invoke('runner:start', payload || {}),

  // ---- 主进程事件 ----
  onOpenSettings: (callback) => subscribe('app:open-settings', () => callback()),
  onSettingsChanged: (callback) => subscribe('app:settings-changed', (settings) => callback(settings)),
});
