export function exportPNG(cy, filename = 'graph.png') {
  const png = cy.png({ output: 'blob', bg: '#0f172a', full: true, scale: 2 });
  downloadBlob(png, filename);
}

export function exportSVG(cy, filename = 'graph.svg') {
  const svg = cy.svg({ full: true, bg: '#0f172a' });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
