import { initAurora } from './aurora.js';

document.addEventListener('DOMContentLoaded', () => {
  const bg = document.getElementById('aurora-bg');
  if (bg) {
    initAurora(bg, {
      colorStops: ['#3A29FF', '#7c5cff', '#4f7cff'],
      amplitude: 1.1,
      blend: 0.55,
      speed: 0.4,
    });
  }
});
