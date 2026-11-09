'use strict';

/**
 * 下班跑步彩蛋覆盖窗的预加载脚本（v3）。
 * 只暴露最小通道：开跑（下发完整时间轴）/ 就绪 / 跑完。
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => {
    try {
      callback(payload);
    } catch (err) {
      console.warn('[runner-preload] 回调异常', err);
    }
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('runnerBridge', {
  ready: () => ipcRenderer.send('runner:ready'),
  done: () => ipcRenderer.send('runner:done'),
  onStart: (callback) => subscribe('runner:start', (payload) => callback(payload)),
});
