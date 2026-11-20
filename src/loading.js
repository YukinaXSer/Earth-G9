export function withTimeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('雨林加载超时，请检查网络或使用流畅模式重试。')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
