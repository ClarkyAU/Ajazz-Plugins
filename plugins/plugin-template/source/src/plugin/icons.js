'use strict';
// Line icons on a 48 x 48 grid. Add your own here. Colour comes from the content.
const icons = {
  gauge: '<path d="M6 34a18 18 0 1 1 36 0"/><path d="M24 34l8-11"/><circle cx="24" cy="34" r="2"/>',
  bolt: '<path d="M28 3L11 27h12l-3 18 17-25H25z"/>',
  link: '<path d="M6 20a26 26 0 0 1 36 0M13 28a16 16 0 0 1 22 0"/><circle cx="24" cy="37" r="3"/>',
  plug: '<path d="M16 4v10M32 4v10"/><path d="M10 14h28v8a14 14 0 0 1-28 0z"/><path d="M24 36v8"/>',
  question: '<path d="M16 17a8 8 0 1 1 11 7.4c-2 1-3 2.5-3 4.6"/><circle cx="24" cy="39" r="1.5"/>'
};

function drawIcon(name, x, y, size, color) {
  const s = size / 48;
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')" fill="none" stroke="' + color +
    '" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">' + (icons[name] || icons.question) + '</g>';
}

module.exports = { icons, drawIcon };
