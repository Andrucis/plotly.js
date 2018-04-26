/**
* Copyright 2012-2018, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var underscore = require('underscore');
var d3 = require('d3');
var isNumeric = require('fast-isnumeric');
var tinycolor = require('tinycolor2');

var Lib = require('../../lib');
var svgTextUtils = require('../../lib/svg_text_utils');

var Color = require('../../components/color');
var Drawing = require('../../components/drawing');
var Registry = require('../../registry');

var attributes = require('./attributes'),
    attributeText = attributes.text,
    attributeTextPosition = attributes.textposition,
    attributeTextFont = attributes.textfont,
    attributeInsideTextFont = attributes.insidetextfont,
    attributeOutsideTextFont = attributes.outsidetextfont;

// padding in pixels around text
var TEXTPAD = 3;

module.exports = function plot(gd, plotinfo, cdbar) {
    var fullLayout = gd._fullLayout;

    cdbar.forEach(function(d, i) {
        cdbar[i] = calculateBarCoordinates(d, plotinfo.xaxis, plotinfo.yaxis);
    });

    if(gd._fullLayout.barmode === 'stack' || gd._fullLayout.barmode === 'relative') {
        cdbar = calculatePositionInStack(cdbar);
    }

    var maxBarRadius = getMaxBarRadius(cdbar);

    var bartraces = plotinfo.plot.select('.barlayer')
        .selectAll('g.trace.bars')
        .data(cdbar);

    bartraces.enter().append('g')
        .attr('class', 'trace bars');

    if(!plotinfo.isRangePlot) {
        bartraces.each(function(d) {
            d[0].node3 = d3.select(this);
        });
    }

    bartraces.append('g')
    .attr('class', 'points')
    .each(function(d) {
        var sel = d3.select(this);
        var trace = d[0].trace;

        sel.selectAll('g.point')
            .data(Lib.identity)
          .enter().append('g').classed('point', true)
            .each(function(di, i) {
                // now display the bar
                // clipped xf/yf (2nd arg true): non-positive
                // log values go off-screen by plotwidth
                // so you see them continue if you drag the plot

                var x0, x1, y0, y1;

                x0 = trace.coordinates[i].x0,
                y0 = trace.coordinates[i].y0,
                x1 = trace.coordinates[i].x1,
                y1 = trace.coordinates[i].y1,
                di.ct = trace.coordinates[i].ct;

                if(!isNumeric(x0) || !isNumeric(x1) ||
                        !isNumeric(y0) || !isNumeric(y1) ||
                        x0 === x1 || y0 === y1) {
                    d3.select(this).remove();
                    return;
                }

                var blr = trace.cornerroundness.bottomleft,
                    brr = trace.cornerroundness.bottomright,
                    tlr = trace.cornerroundness.topleft,
                    trr = trace.cornerroundness.topright;

                // in case of stacked bars removes round corners from middle bars.
                if(trace.stackPosition) {
                    if(!trace.stackPosition.bottom[i]) {
                        if(trace.orientation === 'v') {
                            blr = 0;
                            brr = 0;
                        }
                        else {
                            blr = 0;
                            tlr = 0;
                        }
                    }
                    if(!trace.stackPosition.top[i]) {
                        if(trace.orientation === 'v') {
                            tlr = 0;
                            trr = 0;
                        }
                        else {
                            brr = 0;
                            trr = 0;
                        }
                    }
                }

                var lw = (di.mlw + 1 || trace.marker.line.width + 1 ||
                    (di.trace ? di.trace.marker.line.width : 0) + 1) - 1,
                    offset = d3.round((lw / 2) % 1, 2);

                function roundWithLine(v) {
                    // if there are explicit gaps, don't round,
                    // it can make the gaps look crappy
                    return (fullLayout.bargap === 0 && fullLayout.bargroupgap === 0) ?
                        d3.round(Math.round(v) - offset, 2) : v;
                }

                function expandToVisible(v, vc) {
                    // if it's not in danger of disappearing entirely,
                    // round more precisely
                    return Math.abs(v - vc) >= 2 ? roundWithLine(v) :
                    // but if it's very thin, expand it so it's
                    // necessarily visible, even if it might overlap
                    // its neighbor
                    (v > vc ? Math.ceil(v) : Math.floor(v));
                }

                function generatePathDescription(x0, y0, x1, y1, bl, br, tl, tr) {
                    if(bl === 0 && br === 0 && tl === 0 && tr === 0) {
                        return 'M' + x0 + ',' + y0 + 'V' + y1 + 'H' + x1 + 'V' + y0 + 'Z';
                    }

                    // max allowed arc radius equals least wide edge width divided by two
                    var r = maxBarRadius;

                    if(trace.stackPosition) {
                        // handles all possible bar drawing directions
                        // bottom to top
                        if(x0 < x1 && y0 > y1) {
                            return 'M' + (x0 + r * bl) + ',' + y0 + 'A' + r * bl + ',' + r * bl + ' 0 0 1 ' + x0 + ',' + (y0 - r * bl) +
                                'V' + (y1 + r * tl) + 'A' + r * tl + ',' + r * tl + ' 0 0 1 ' + (x0 + r * tl) + ',' + (y1) +
                                'H' + (x1 - r * tr) + 'A' + r * tr + ',' + r * tr + ' 0 0 1 ' + x1 + ',' + (y1 + r * tr) +
                                'V' + (y0 - r * br) + 'A' + r * br + ',' + r * br + ' 0 0 1 ' + (x1 - r * br) + ',' + y0 + 'Z';
                        }
                        // top to bottom
                        if(x0 > x1 && y0 < y1) {
                            return 'M' + (x0 - r * tr) + ',' + y0 + 'A' + r * tr + ',' + r * tr + ' 0 0 1 ' + x0 + ',' + (y0 + r * tr) +
                                'V' + (y1 - r * br) + 'A' + r * br + ',' + r * br + ' 0 0 1 ' + (x0 - r * br) + ',' + (y1) +
                                'H' + (x1 + r * bl) + 'A' + r * bl + ',' + r * bl + ' 0 0 1 ' + x1 + ',' + (y1 - r * bl) +
                                'V' + (y0 + r * tl) + 'A' + r * tl + ',' + r * tl + ' 0 0 1 ' + (x1 + r * tl) + ',' + y0 + 'Z';
                        }
                        // left to right
                        if(x0 < x1 && y0 < y1) {
                            return 'M' + (x0 + r * tl) + ',' + y0 + 'A' + r * tl + ',' + r * tl + ' 1 0 0 ' + x0 + ',' + (y0 + r * tl) +
                                'V' + (y1 - r * bl) + 'A' + r * bl + ',' + r * bl + ' 1 0 0 ' + (x0 + r * bl) + ',' + (y1) +
                                'H' + (x1 - r * br) + 'A' + r * br + ',' + r * br + ' 1 0 0 ' + x1 + ',' + (y1 - r * br) +
                                'V' + (y0 + r * tr) + 'A' + r * tr + ',' + r * tr + ' 1 0 0 ' + (x1 - r * tr) + ',' + y0 + 'Z';
                        }
                        // right to left
                        if(x0 > x1 && y0 > y1) {
                            return 'M' + (x0 - r * br) + ',' + y0 + 'A' + r * br + ',' + r * br + ' 1 0 0 ' + x0 + ',' + (y0 - r * br) +
                                'V' + (y1 + r * tr) + 'A' + r * tr + ',' + r * tr + ' 1 0 0 ' + (x0 - r * tr) + ',' + (y1) +
                                'H' + (x1 + r * tl) + 'A' + r * tl + ',' + r * tl + ' 1 0 0 ' + x1 + ',' + (y1 + r * tl) +
                                'V' + (y0 - r * bl) + 'A' + r * bl + ',' + r * bl + ' 1 0 0 ' + (x1 + r * bl) + ',' + y0 + 'Z';
                        }
                    }
                    else {
                        // handles all possible bar drawing directions
                        if(x0 < x1 && y0 > y1) {
                            // bottom to top
                            if(trace.orientation === 'v') {
                                return 'M' + (x0 + r * bl) + ',' + y0 + 'A' + r * bl + ',' + r * bl + ' 0 0 1 ' + x0 + ',' + (y0 - r * bl) +
                                    'V' + (y1 + r * tl) + 'A' + r * tl + ',' + r * tl + ' 0 0 1 ' + (x0 + r * tl) + ',' + (y1) +
                                    'H' + (x1 - r * tr) + 'A' + r * tr + ',' + r * tr + ' 0 0 1 ' + x1 + ',' + (y1 + r * tr) +
                                    'V' + (y0 - r * br) + 'A' + r * br + ',' + r * br + ' 0 0 1 ' + (x1 - r * br) + ',' + y0 + 'Z';
                            }
                            // right to left
                            if(trace.orientation === 'h') {
                                return 'M' + (x0 + r * bl) + ',' + y0 + 'A' + r * bl + ',' + r * bl + ' 0 0 1 ' + x0 + ',' + (y0 - r * bl) +
                                    'V' + (y1 + r * br) + 'A' + r * br + ',' + r * br + ' 0 0 1 ' + (x0 + r * br) + ',' + (y1) +
                                    'H' + (x1 - r * tr) + 'A' + r * tr + ',' + r * tr + ' 0 0 1 ' + x1 + ',' + (y1 + r * tr) +
                                    'V' + (y0 - r * tl) + 'A' + r * tl + ',' + r * tl + ' 0 0 1 ' + (x1 - r * tl) + ',' + y0 + 'Z';
                            }
                        }
                        // top to bottom
                        if(x0 < x1 && y0 < y1) {
                            return 'M' + (x0 + r * bl) + ',' + y0 + 'A' + r * bl + ',' + r * bl + ' 1 0 0 ' + x0 + ',' + (y0 + r * bl) +
                                'V' + (y1 - r * tl) + 'A' + r * tl + ',' + r * tl + ' 1 0 0 ' + (x0 + r * tl) + ',' + (y1) +
                                'H' + (x1 - r * tr) + 'A' + r * tr + ',' + r * tr + ' 1 0 0 ' + x1 + ',' + (y1 - r * tr) +
                                'V' + (y0 + r * br) + 'A' + r * br + ',' + r * br + ' 1 0 0 ' + (x1 - r * br) + ',' + y0 + 'Z';
                        }
                        // left to right
                        if(x0 > x1 && y0 > y1) {
                            return 'M' + (x0 - r * bl) + ',' + y0 + 'A' + r * bl + ',' + r * bl + ' 1 0 0 ' + x0 + ',' + (y0 - r * bl) +
                                'V' + (y1 + r * br) + 'A' + r * br + ',' + r * br + ' 1 0 0 ' + (x0 - r * br) + ',' + (y1) +
                                'H' + (x1 + r * tr) + 'A' + r * tr + ',' + r * tr + ' 1 0 0 ' + x1 + ',' + (y1 + r * tr) +
                                'V' + (y0 - r * tl) + 'A' + r * tl + ',' + r * tl + ' 1 0 0 ' + (x1 + r * tl) + ',' + y0 + 'Z';
                        }
                        // unknown
                        if(x0 > x1 && y0 < y1) {
                            return 'M' + (x0 - r * tr) + ',' + y0 + 'A' + r * tr + ',' + r * tr + ' 0 0 1 ' + x0 + ',' + (y0 + r * tr) +
                                'V' + (y1 - r * tl) + 'A' + r * tl + ',' + r * tl + ' 0 0 1 ' + (x0 - r * tl) + ',' + (y1) +
                                'H' + (x1 + r * bl) + 'A' + r * bl + ',' + r * bl + ' 0 0 1 ' + x1 + ',' + (y1 - r * bl) +
                                'V' + (y0 + r * br) + 'A' + r * br + ',' + r * br + ' 0 0 1 ' + (x1 + r * br) + ',' + y0 + 'Z';
                        }
                    }

                }

                if(!gd._context.staticPlot) {
                    // if bars are not fully opaque or they have a line
                    // around them, round to integer pixels, mainly for
                    // safari so we prevent overlaps from its expansive
                    // pixelation. if the bars ARE fully opaque and have
                    // no line, expand to a full pixel to make sure we
                    // can see them
                    var op = Color.opacity(di.mc || trace.marker.color),
                        fixpx = (op < 1 || lw > 0.01) ?
                            roundWithLine : expandToVisible;
                    x0 = fixpx(x0, x1);
                    x1 = fixpx(x1, x0);
                    y0 = fixpx(y0, y1);
                    y1 = fixpx(y1, y0);
                }

                // append bar path and text
                var bar = d3.select(this);

                bar.append('path')
                        .style('vector-effect', 'non-scaling-stroke')
                        .attr('d', generatePathDescription(x0, y0, x1, y1, blr, brr, tlr, trr))
                        .call(Drawing.setClipUrl, plotinfo.layerClipId);

                appendBarText(gd, bar, d, i, x0, x1, y0, y1);

                if(plotinfo.layerClipId) {
                    Drawing.hideOutsideRangePoint(d[i], bar.select('text'), plotinfo.xaxis, plotinfo.yaxi, trace.xcalendar, trace.ycalendar);
                }
            });
    });

    // error bars are on the top
    Registry.getComponentMethod('errorbars', 'plot')(bartraces, plotinfo);

    // lastly, clip points groups of `cliponaxis !== false` traces
    // on `plotinfo._hasClipOnAxisFalse === true` subplots
    bartraces.each(function(d) {
        var hasClipOnAxisFalse = d[0].trace.cliponaxis === false;
        Drawing.setClipUrl(d3.select(this), hasClipOnAxisFalse ? null : plotinfo.layerClipId);
    });
};

function appendBarText(gd, bar, calcTrace, i, x0, x1, y0, y1) {
    var textPosition;

    function appendTextNode(bar, text, textFont) {
        var textSelection = bar.append('text')
            .text(text)
            .attr({
                'class': 'bartext bartext-' + textPosition,
                transform: '',
                'text-anchor': 'middle',
                // prohibit tex interpretation until we can handle
                // tex and regular text together
                'data-notex': 1
            })
            .call(Drawing.font, textFont)
            .call(svgTextUtils.convertToTspans, gd);

        return textSelection;
    }

    // get trace attributes
    var trace = calcTrace[0].trace,
        orientation = trace.orientation;

    var text = getText(trace, i);
    if(!text) return;

    textPosition = getTextPosition(trace, i);
    if(textPosition === 'none') return;

    var textFont = getTextFont(trace, i, gd._fullLayout.font),
        insideTextFont = getInsideTextFont(trace, i, textFont),
        outsideTextFont = getOutsideTextFont(trace, i, textFont);

    // compute text position
    var barmode = gd._fullLayout.barmode,
        inStackMode = (barmode === 'stack'),
        inRelativeMode = (barmode === 'relative'),
        inStackOrRelativeMode = inStackMode || inRelativeMode,

        calcBar = calcTrace[i],
        isOutmostBar = !inStackOrRelativeMode || calcBar._outmost,

        barWidth = Math.abs(x1 - x0) - 2 * TEXTPAD,  // padding excluded
        barHeight = Math.abs(y1 - y0) - 2 * TEXTPAD,  // padding excluded

        textSelection,
        textBB,
        textWidth,
        textHeight;

    if(textPosition === 'outside') {
        if(!isOutmostBar) textPosition = 'inside';
    }

    if(textPosition === 'auto') {
        if(isOutmostBar) {
            // draw text using insideTextFont and check if it fits inside bar
            textPosition = 'inside';
            textSelection = appendTextNode(bar, text, insideTextFont);

            textBB = Drawing.bBox(textSelection.node()),
            textWidth = textBB.width,
            textHeight = textBB.height;

            var textHasSize = (textWidth > 0 && textHeight > 0),
                fitsInside =
                    (textWidth <= barWidth && textHeight <= barHeight),
                fitsInsideIfRotated =
                    (textWidth <= barHeight && textHeight <= barWidth),
                fitsInsideIfShrunk = (orientation === 'h') ?
                    (barWidth >= textWidth * (barHeight / textHeight)) :
                    (barHeight >= textHeight * (barWidth / textWidth));
            if(textHasSize &&
                    (fitsInside || fitsInsideIfRotated || fitsInsideIfShrunk)) {
                textPosition = 'inside';
            }
            else {
                textPosition = 'outside';
                textSelection.remove();
                textSelection = null;
            }
        }
        else textPosition = 'inside';
    }

    if(!textSelection) {
        textSelection = appendTextNode(bar, text,
                (textPosition === 'outside') ?
                outsideTextFont : insideTextFont);

        textBB = Drawing.bBox(textSelection.node()),
        textWidth = textBB.width,
        textHeight = textBB.height;

        if(textWidth <= 0 || textHeight <= 0) {
            textSelection.remove();
            return;
        }
    }

    // compute text transform
    var transform, constrained;
    if(textPosition === 'outside') {
        constrained = trace.constraintext === 'both' || trace.constraintext === 'outside';
        transform = getTransformToMoveOutsideBar(x0, x1, y0, y1, textBB,
            orientation, constrained);
    }
    else {
        constrained = trace.constraintext === 'both' || trace.constraintext === 'inside';
        transform = getTransformToMoveInsideBar(x0, x1, y0, y1, textBB,
            orientation, constrained);
    }

    textSelection.attr('transform', transform);
}

function calculateBarCoordinates(d, xa, ya) {
    // calculates bar coordinates in order to later find out appropriate corner roundness radius
    var t = d[0].t;
    var trace = d[0].trace;
    var poffset = t.poffset;
    var poffsetIsArray = Array.isArray(poffset);

    trace.coordinates = [];

    d.forEach(function(di, i) {
        var p0 = di.p + ((poffsetIsArray) ? poffset[i] : poffset),
            p1 = p0 + di.w,
            s0 = di.b,
            s1 = s0 + di.s;
        var x0, x1, y0, y1;
        if(trace.orientation === 'h') {
            y0 = ya.c2p(p0, true);
            y1 = ya.c2p(p1, true);
            x0 = xa.c2p(s0, true);
            x1 = xa.c2p(s1, true);
            // for selections
            di.ct = [x1, (y0 + y1) / 2];
        }
        else {
            x0 = xa.c2p(p0, true);
            x1 = xa.c2p(p1, true);
            y0 = ya.c2p(s0, true);
            y1 = ya.c2p(s1, true);
            // for selections
            di.ct = [(x0 + x1) / 2, y1];
        }
        trace.coordinates.push({ x0: x0, y0: y0, x1: x1, y1: y1, ct: di.ct });
    });
    d[0].trace = trace;
    return d;
}

function calculatePositionInStack(cdbar) {
    // calculate which bars go into which stack,
    // and whether the bar is in stack top or bottom
    var array = [];
    for(var i = 0; i < cdbar.length; i++) {
        var object = (cdbar[i][0].trace.orientation === 'v') ? underscore.object(cdbar[i][0].trace.x, cdbar[i][0].trace.y) : underscore.object(cdbar[i][0].trace.y, cdbar[i][0].trace.x);
        array.push(object);
    }
    var index = 0;
    array.reverse().forEach(function(o) {
        var cdbarIndex = array.length - index - 1;
        cdbar[cdbarIndex][0].trace.stackPosition = {
            bottom: [],
            top: []
        };
        Object.keys(o).forEach(function(key) {
            var topResult = true;
            var bottomResult = true;
            if(o[key] === null) {
                topResult = bottomResult = false;
            }
            else {
                var j = index;
                while(--j >= 0) {
                    if(!bottomResult && !topResult) break;
                    if(array[j].hasOwnProperty(key)) {
                        if(array[index][key] < 0 && array[j][key] < 0) bottomResult = false;
                        if(array[index][key] < 0 && array[j][key] > 0) topResult = false;
                        if(array[index][key] >= 0 && array[j][key] > 0) topResult = false;
                        if(array[index][key] >= 0 && array[j][key] < 0) bottomResult = false;
                    }
                }
                j = index;
                while(++j < array.length) {
                    if(!bottomResult && !topResult) break;
                    if(array[j].hasOwnProperty(key)) {
                        if(array[index][key] < 0 && array[j][key]) topResult = false;
                        if(array[index][key] >= 0 && array[j][key]) bottomResult = false;
                    }
                }
            }
            cdbar[cdbarIndex][0].trace.stackPosition.bottom.push(bottomResult);
            cdbar[cdbarIndex][0].trace.stackPosition.top.push(topResult);
        });
        index++;
    });
    return cdbar;
}

function getMaxBarRadius(cdbar) {
    // max bar roundness radius is equal to least widest bar width,
    // so all the bars look the same otherwise larger bars will look completely
    // different from very small bar. If high roundness percentage is used.
    var maxBarRadius = null;
    cdbar.forEach(function(d) {
        d[0].trace.coordinates.forEach(function(di, i) {
            // skip bars that aren't in the top or the bottom of the bar.
            if(d[0].trace.stackPosition && (!d[0].trace.stackPosition.bottom[i] && !d[0].trace.stackPosition.top[i])) return;
            else {
                var r = Math.min(Math.abs(di.x0 - di.x1), Math.abs(di.y0 - di.y1)) / 2;
                maxBarRadius = (maxBarRadius > r || !isNumeric(maxBarRadius || maxBarRadius === 0)) ? r : maxBarRadius;
            }
        });
    });
    return (maxBarRadius !== null) ? maxBarRadius : 0;
}

function getTransformToMoveInsideBar(x0, x1, y0, y1, textBB, orientation, constrained) {
    // compute text and target positions
    var textWidth = textBB.width,
        textHeight = textBB.height,
        textX = (textBB.left + textBB.right) / 2,
        textY = (textBB.top + textBB.bottom) / 2,
        barWidth = Math.abs(x1 - x0),
        barHeight = Math.abs(y1 - y0),
        targetWidth,
        targetHeight,
        targetX,
        targetY;

    // apply text padding
    var textpad;
    if(barWidth > (2 * TEXTPAD) && barHeight > (2 * TEXTPAD)) {
        textpad = TEXTPAD;
        barWidth -= 2 * textpad;
        barHeight -= 2 * textpad;
    }
    else textpad = 0;

    // compute rotation and scale
    var rotate,
        scale;

    if(textWidth <= barWidth && textHeight <= barHeight) {
        // no scale or rotation is required
        rotate = false;
        scale = 1;
    }
    else if(textWidth <= barHeight && textHeight <= barWidth) {
        // only rotation is required
        rotate = true;
        scale = 1;
    }
    else if((textWidth < textHeight) === (barWidth < barHeight)) {
        // only scale is required
        rotate = false;
        scale = constrained ? Math.min(barWidth / textWidth, barHeight / textHeight) : 1;
    }
    else {
        // both scale and rotation are required
        rotate = true;
        scale = constrained ? Math.min(barHeight / textWidth, barWidth / textHeight) : 1;
    }

    if(rotate) rotate = 90;  // rotate clockwise

    // compute text and target positions
    if(rotate) {
        targetWidth = scale * textHeight;
        targetHeight = scale * textWidth;
    }
    else {
        targetWidth = scale * textWidth;
        targetHeight = scale * textHeight;
    }

    if(orientation === 'h') {
        if(x1 < x0) {
            // bar end is on the left hand side
            targetX = x1 + textpad + targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
        else {
            targetX = x1 - textpad - targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
    }
    else {
        if(y1 > y0) {
            // bar end is on the bottom
            targetX = (x0 + x1) / 2;
            targetY = y1 - textpad - targetHeight / 2;
        }
        else {
            targetX = (x0 + x1) / 2;
            targetY = y1 + textpad + targetHeight / 2;
        }
    }

    return getTransform(textX, textY, targetX, targetY, scale, rotate);
}

function getTransformToMoveOutsideBar(x0, x1, y0, y1, textBB, orientation, constrained) {
    var barWidth = (orientation === 'h') ?
            Math.abs(y1 - y0) :
            Math.abs(x1 - x0),
        textpad;

    // Keep the padding so the text doesn't sit right against
    // the bars, but don't factor it into barWidth
    if(barWidth > 2 * TEXTPAD) {
        textpad = TEXTPAD;
    }

    // compute rotation and scale
    var scale = 1;
    if(constrained) {
        scale = (orientation === 'h') ?
            Math.min(1, barWidth / textBB.height) :
            Math.min(1, barWidth / textBB.width);
    }

    // compute text and target positions
    var textX = (textBB.left + textBB.right) / 2,
        textY = (textBB.top + textBB.bottom) / 2,
        targetWidth,
        targetHeight,
        targetX,
        targetY;

    targetWidth = scale * textBB.width;
    targetHeight = scale * textBB.height;

    if(orientation === 'h') {
        if(x1 < x0) {
            // bar end is on the left hand side
            targetX = x1 - textpad - targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
        else {
            targetX = x1 + textpad + targetWidth / 2;
            targetY = (y0 + y1) / 2;
        }
    }
    else {
        if(y1 > y0) {
            // bar end is on the bottom
            targetX = (x0 + x1) / 2;
            targetY = y1 + textpad + targetHeight / 2;
        }
        else {
            targetX = (x0 + x1) / 2;
            targetY = y1 - textpad - targetHeight / 2;
        }
    }

    return getTransform(textX, textY, targetX, targetY, scale, false);
}

function getTransform(textX, textY, targetX, targetY, scale, rotate) {
    var transformScale,
        transformRotate,
        transformTranslate;

    if(scale < 1) transformScale = 'scale(' + scale + ') ';
    else {
        scale = 1;
        transformScale = '';
    }

    transformRotate = (rotate) ?
        'rotate(' + rotate + ' ' + textX + ' ' + textY + ') ' : '';

    // Note that scaling also affects the center of the text box
    var translateX = (targetX - scale * textX),
        translateY = (targetY - scale * textY);
    transformTranslate = 'translate(' + translateX + ' ' + translateY + ')';

    return transformTranslate + transformScale + transformRotate;
}

function getText(trace, index) {
    var value = getValue(trace.text, index);
    return coerceString(attributeText, value);
}

function getTextPosition(trace, index) {
    var value = getValue(trace.textposition, index);
    return coerceEnumerated(attributeTextPosition, value);
}

function getTextFont(trace, index, defaultValue) {
    return getFontValue(
        attributeTextFont, trace.textfont, index, defaultValue);
}

function getInsideTextFont(trace, index, defaultValue) {
    return getFontValue(
        attributeInsideTextFont, trace.insidetextfont, index, defaultValue);
}

function getOutsideTextFont(trace, index, defaultValue) {
    return getFontValue(
        attributeOutsideTextFont, trace.outsidetextfont, index, defaultValue);
}

function getFontValue(attributeDefinition, attributeValue, index, defaultValue) {
    attributeValue = attributeValue || {};

    var familyValue = getValue(attributeValue.family, index),
        sizeValue = getValue(attributeValue.size, index),
        colorValue = getValue(attributeValue.color, index);

    return {
        family: coerceString(
            attributeDefinition.family, familyValue, defaultValue.family),
        size: coerceNumber(
            attributeDefinition.size, sizeValue, defaultValue.size),
        color: coerceColor(
            attributeDefinition.color, colorValue, defaultValue.color)
    };
}

function getValue(arrayOrScalar, index) {
    var value;
    if(!Array.isArray(arrayOrScalar)) value = arrayOrScalar;
    else if(index < arrayOrScalar.length) value = arrayOrScalar[index];
    return value;
}

function coerceString(attributeDefinition, value, defaultValue) {
    if(typeof value === 'string') {
        if(value || !attributeDefinition.noBlank) return value;
    }
    else if(typeof value === 'number') {
        if(!attributeDefinition.strict) return String(value);
    }

    return (defaultValue !== undefined) ?
        defaultValue :
        attributeDefinition.dflt;
}

function coerceEnumerated(attributeDefinition, value, defaultValue) {
    if(attributeDefinition.coerceNumber) value = +value;

    if(attributeDefinition.values.indexOf(value) !== -1) return value;

    return (defaultValue !== undefined) ?
        defaultValue :
        attributeDefinition.dflt;
}

function coerceNumber(attributeDefinition, value, defaultValue) {
    if(isNumeric(value)) {
        value = +value;

        var min = attributeDefinition.min,
            max = attributeDefinition.max,
            isOutOfBounds = (min !== undefined && value < min) ||
                (max !== undefined && value > max);

        if(!isOutOfBounds) return value;
    }

    return (defaultValue !== undefined) ?
        defaultValue :
        attributeDefinition.dflt;
}

function coerceColor(attributeDefinition, value, defaultValue) {
    if(tinycolor(value).isValid()) return value;

    return (defaultValue !== undefined) ?
        defaultValue :
        attributeDefinition.dflt;
}
