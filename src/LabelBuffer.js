/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  and to find labels underneath a mouse cursor's position
*/
'use strict';
const RBush = require('rbush');
const stringWidth = require('string-width');

module.exports = class LabelBuffer {

  constructor() {
    this.tree = new RBush();
    this.margin = 5;
  }

  // Forgets all placed labels
  clear() {
    this.tree.clear();
  }

  // A pixel's cell: [column, row]
  project(x, y) {
    return [Math.floor(x/2), Math.floor(y/4)];
  }

  // Places a label if its area (with the margin) is free; returns whether it did
  writeIfPossible(text, x, y, feature, margin) {
    margin = margin || this.margin;

    const point = this.project(x, y);

    if (this._hasSpace(text, point[0], point[1])) {
      const data = this._calculateArea(text, point[0], point[1], margin);
      data.feature = feature;
      return this.tree.insert(data);
    } else {
      return false;
    }
  }

  // The labels at a cell
  featuresAt(x, y) {
    return this.tree.search({minX: x, maxX: x, minY: y, maxY: y});
  }

  // Whether the text's area at this place is free
  _hasSpace(text, x, y) {
    return !this.tree.collides(this._calculateArea(text, x, y));
  }

  // The area text takes at a place, with a margin
  _calculateArea(text, x, y, margin = 0) {
    return {
      minX: x-margin,
      minY: y-margin/2,
      maxX: x+margin+stringWidth(text),
      maxY: y+margin/2,
    };
  }
};
