/**
 * Network building for ImgNetMaker
 *
 * Turns the rows ImgNetMaker already holds (one row per image, with
 * inm_filename, inm_imgdataurl and the original metadata columns) into a
 * network, without leaving the browser and without joining tables by hand.
 *
 * Two network types:
 *  - "bipartite":  image nodes linked to the values of one or more columns
 *                  (hashtags, labels, keywords, accounts...), like Table2Net.
 *  - "images":     image nodes linked to each other when they share values;
 *                  edge weight = number of shared values.
 *
 * Two outputs:
 *  - Gephi Lite project file (.json): images are already switched on, using
 *    the embedded thumbnails. This sidesteps the current Gephi Lite image
 *    dropdown, which no longer lists data-URL columns.
 *  - GEXF (.gexf) for Gephi desktop: carries an "image" column with the image
 *    filename, as expected by the Image Preview plugin (point its Image Path to
 *    the images folder from the ImgNetMaker ZIP or your own folder).
 */
class NetworkBuilder {

    /**
     * Normalise a filename or ID so that "Folder/IMG_01.JPG", "img_01.jpg"
     * and "img_01" all match.
     */
    static matchKey(value) {
        if (value === undefined || value === null) return '';
        let key = String(value).trim().toLowerCase();
        key = key.split(/[\\/]/).pop();               // drop any path
        key = key.split('?')[0];                      // drop URL query
        key = key.replace(/\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic)$/i, '');
        return key;
    }

    /**
     * Attach metadata rows to image rows by matching a metadata column
     * against the image filenames.
     *
     * @param {Object[]} imageRows Rows with inm_filename
     * @param {Object[]} metaRows Rows from a metadata CSV
     * @param {String} metaColumn Column in metaRows holding the image ID / filename
     * @returns {{rows: Object[], matched: number, unmatchedImages: string[], unmatchedMeta: string[]}}
     */
    static joinMetadata(imageRows, metaRows, metaColumn) {
        const index = new Map();
        metaRows.forEach(row => {
            const key = NetworkBuilder.matchKey(row[metaColumn]);
            if (key && !index.has(key)) index.set(key, row);
        });

        const used = new Set();
        const unmatchedImages = [];
        const rows = imageRows.map(imgRow => {
            const key = NetworkBuilder.matchKey(imgRow.inm_filename);
            const meta = index.get(key);
            if (!meta) {
                unmatchedImages.push(imgRow.inm_filename);
                return imgRow;
            }
            used.add(key);
            // Image fields win over metadata fields with the same name
            return Object.assign({}, meta, imgRow);
        });

        const unmatchedMeta = [...index.keys()].filter(k => !used.has(k));
        return {rows, matched: used.size, unmatchedImages, unmatchedMeta};
    }

    /**
     * Guess the separator used for multi-value cells.
     */
    static detectSeparator(values) {
        const sample = values.filter(v => typeof v === 'string' && v.trim()).slice(0, 500);
        const candidates = [';', '|', ','];
        let best = 'none';
        let bestCount = 0;
        candidates.forEach(sep => {
            const count = sample.filter(v => v.includes(sep)).length;
            if (count > bestCount) {
                best = sep;
                bestCount = count;
            }
        });
        // Hashtag lists separated by spaces: "#rio #brazil"
        if (bestCount === 0) {
            const hashtags = sample.filter(v => /#\S+\s+#\S+/.test(v)).length;
            if (hashtags > 0) best = ' ';
        }
        return best;
    }

    static splitValues(value, separator) {
        if (value === undefined || value === null) return [];
        const str = String(value).trim();
        if (!str) return [];
        const parts = (separator === 'none') ? [str] : str.split(separator);
        return parts.map(p => p.trim()).filter(p => p);
    }

    /**
     * Build the network.
     *
     * @param {Object[]} rows Image rows
     * @param {Object} options
     * @param {String[]} options.columns Columns whose values become links
     * @param {String} options.separator 'auto', 'none', ';', ',', '|', ' '
     * @param {String} options.mode 'bipartite' or 'images'
     * @param {Boolean} options.caseSensitive Treat "Rio" and "rio" as different values
     * @param {Number} options.minWeight Minimum shared values for image-image links
     * @returns {{nodes: Object[], edges: Object[], stats: Object, fields: String[], options: Object}}
     */
    static build(rows, options = {}) {
        const columns = options.columns || [];
        const mode = options.mode || 'bipartite';
        const caseSensitive = !!options.caseSensitive;
        const minWeight = options.minWeight || 1;

        if (!columns.length) throw Error('Choose at least one column to connect the images.');

        const separators = {};
        columns.forEach(col => {
            separators[col] = (options.separator && options.separator !== 'auto')
                ? options.separator
                : NetworkBuilder.detectSeparator(rows.map(r => r[col]));
        });

        // Metadata fields copied onto image nodes
        const skip = new Set(['fileobject', 'inm_status']);
        const fieldSet = new Set();
        rows.forEach(r => Object.keys(r).forEach(k => {
            if (!skip.has(k) && typeof r[k] !== 'object') fieldSet.add(k);
        }));
        const fields = [...fieldSet];

        // Image nodes
        const nodes = [];
        const usedIds = new Set();
        const imageIds = [];
        let skipped = 0;
        rows.forEach((row, i) => {
            if (!row.inm_imgdataurl && !row.inm_filename) {
                imageIds.push(null);
                skipped++;
                return;
            }
            let id = 'img:' + (row.inm_filename || String(i));
            if (usedIds.has(id)) id = id + ':' + i;
            usedIds.add(id);
            imageIds.push(id);

            const attributes = {};
            fields.forEach(f => {
                if (row[f] !== undefined && row[f] !== null && row[f] !== '') attributes[f] = row[f];
            });
            nodes.push({
                id,
                label: row.inm_filename || id,
                kind: 'image',
                image: row.inm_filename || '',
                dataUrl: row.inm_imgdataurl || '',
                attributes
            });
        });

        // Values per image, and images per value
        const valueNodes = new Map();      // key -> node
        const imagesPerValue = new Map();  // key -> Set(imageId)
        rows.forEach((row, i) => {
            const imgId = imageIds[i];
            if (!imgId) return;
            columns.forEach(col => {
                NetworkBuilder.splitValues(row[col], separators[col]).forEach(value => {
                    const norm = caseSensitive ? value : value.toLowerCase();
                    const key = col + '::' + norm;
                    if (!valueNodes.has(key)) {
                        valueNodes.set(key, {
                            id: 'val:' + key,
                            label: value,
                            kind: col,
                            attributes: {}
                        });
                        imagesPerValue.set(key, new Set());
                    }
                    imagesPerValue.get(key).add(imgId);
                });
            });
        });

        const edges = [];
        if (mode === 'bipartite') {
            valueNodes.forEach((node, key) => {
                nodes.push(node);
                imagesPerValue.get(key).forEach(imgId => {
                    edges.push({source: imgId, target: node.id, weight: 1, kind: node.kind});
                });
            });
        } else {
            // Image-image links weighted by shared values
            const pairs = new Map();
            const maxPairs = options.maxEdges || 500000;
            for (const [, imgSet] of imagesPerValue) {
                const ids = [...imgSet].sort();
                for (let a = 0; a < ids.length; a++) {
                    for (let b = a + 1; b < ids.length; b++) {
                        const k = ids[a] + '\u0000' + ids[b];
                        pairs.set(k, (pairs.get(k) || 0) + 1);
                        if (pairs.size > maxPairs) {
                            throw Error(`Too many image-image links (over ${maxPairs}). ` +
                                'Some values are shared by very many images; use the images-and-values network instead, or remove very common values.');
                        }
                    }
                }
            }
            pairs.forEach((w, k) => {
                if (w < minWeight) return;
                const [s, t] = k.split('\u0000');
                edges.push({source: s, target: t, weight: w});
            });
        }

        const imageCount = nodes.filter(n => n.kind === 'image').length;
        return {
            nodes,
            edges,
            fields,
            options: {columns, separators, mode, caseSensitive, minWeight},
            stats: {
                images: imageCount,
                values: mode === 'bipartite' ? nodes.length - imageCount : valueNodes.size,
                edges: edges.length,
                isolatedImages: imageCount - new Set(edges.flatMap(e => [e.source, e.target]).filter(id => id.startsWith('img:'))).size,
                skippedRows: skipped
            }
        };
    }

    /**
     * Spread nodes on a disc so the first view in Gephi Lite is readable;
     * run ForceAtlas2 there for the actual layout.
     */
    static initialLayout(nodes) {
        const layout = {};
        const radius = Math.max(100, Math.sqrt(nodes.length) * 40);
        // Deterministic golden-angle spiral (same file, same picture)
        nodes.forEach((n, i) => {
            const r = radius * Math.sqrt((i + 0.5) / nodes.length);
            const theta = i * 2.399963229728653;
            layout[n.id] = {x: r * Math.cos(theta), y: r * Math.sin(theta)};
        });
        return layout;
    }

    static palette(kinds) {
        // Images in grey; value types in greens and greys
        const colours = ['#00C853', '#1B5E20', '#69F0AE', '#2E7D32', '#424242', '#B9F6CA'];
        const p = {image: '#9E9E9E'};
        kinds.filter(k => k !== 'image').forEach((k, i) => p[k] = colours[i % colours.length]);
        return p;
    }

    static fieldType(values) {
        const filled = values.filter(v => v !== undefined && v !== null && v !== '');
        if (!filled.length) return 'text';
        if (filled.every(v => !isNaN(Number(v)) && String(v).trim() !== '')) return 'number';
        return 'text';
    }

    /**
     * Gephi Lite project file (format "gephi-lite", version 1.1.0).
     */
    static toGephiLite(network, title = 'ImgNetMaker network') {
        const {nodes, edges, fields} = network;
        const kinds = [...new Set(nodes.map(n => n.kind))];
        const palette = NetworkBuilder.palette(kinds);

        const reserved = new Set(['label', 'kind', 'image', 'inm_imgdataurl']);
        const metaFields = fields.filter(f => !reserved.has(f));

        const nodeData = {};
        nodes.forEach(n => {
            const d = {label: n.label, kind: n.kind};
            if (n.kind === 'image') {
                d.image = n.image;
                if (n.dataUrl) d.inm_imgdataurl = n.dataUrl;
                metaFields.forEach(f => {
                    if (n.attributes[f] !== undefined) d[f] = n.attributes[f];
                });
            }
            nodeData[n.id] = d;
        });

        const edgeData = {};
        const graphEdges = [];
        edges.forEach((e, i) => {
            const key = 'e' + i;
            edgeData[key] = {weight: e.weight};
            graphEdges.push({key, source: e.source, target: e.target});
        });

        const nodeFields = [
            {id: 'label', itemType: 'nodes', type: 'text'},
            {id: 'kind', itemType: 'nodes', type: 'category'},
            {id: 'image', itemType: 'nodes', type: 'text'},
            // Declared as "url" so Gephi Lite offers it in Appearance > Images
            {id: 'inm_imgdataurl', itemType: 'nodes', type: 'url'},
            ...metaFields.map(f => ({
                id: f, itemType: 'nodes',
                type: NetworkBuilder.fieldType(nodes.map(n => n.attributes[f]))
            }))
        ];

        const appearance = {
            showEdges: {value: true},
            nodesSize: {
                type: 'ranking',
                field: {id: 'degree', itemType: 'nodes', type: 'number', dynamic: true},
                missingSize: 6, minSize: 8, maxSize: 40
            },
            edgesSize: {
                type: 'ranking',
                field: {id: 'weight', itemType: 'edges', type: 'number'},
                missingSize: 1, minSize: 0.5, maxSize: 6
            },
            backgroundColor: '#FFFFFF00',
            layoutGridColor: '#666666',
            nodesColor: {
                type: 'partition',
                field: {id: 'kind', itemType: 'nodes', type: 'category'},
                colorPalette: palette,
                missingColor: '#BDBDBD'
            },
            edgesColor: {type: 'fixed', value: '#d6d6d6'},
            nodesLabel: {
                type: 'field',
                field: {id: 'label', itemType: 'nodes', type: 'text'}
            },
            edgesLabel: {type: 'none'},
            nodesLabelSize: {type: 'fixed', value: 12, zoomCorrelation: 0, density: 1},
            edgesLabelSize: {type: 'fixed', value: 12, zoomCorrelation: 0, density: 1},
            nodesLabelEllipsis: {type: 'ellipsis', enabled: true, maxLength: 25},
            edgesLabelEllipsis: {type: 'ellipsis', enabled: false, maxLength: 25},
            nodesImage: {
                type: 'field',
                field: {id: 'inm_imgdataurl', itemType: 'nodes', type: 'url'}
            },
            edgesZIndex: {type: 'none'}
        };

        return {
            type: 'gephi-lite',
            version: '1.1.0',
            graphDataset: {
                nodeData,
                edgeData,
                layout: NetworkBuilder.initialLayout(nodes),
                metadata: {title},
                nodeFields,
                edgeFields: [{id: 'weight', itemType: 'edges', type: 'number'}],
                fullGraph: {
                    options: {type: 'undirected', multi: false, allowSelfLoops: false},
                    attributes: {},
                    nodes: nodes.map(n => ({key: n.id})),
                    edges: graphEdges
                }
            },
            filters: {filters: []},
            appearance
        };
    }

    static xmlEscape(value) {
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
            // Characters not allowed in XML 1.0
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }

    /**
     * GEXF 1.3 for Gephi desktop (and any other GEXF reader).
     *
     * @param {Boolean} includeDataUrl Also embed the thumbnails (larger file)
     */
    static toGexf(network, includeDataUrl = false) {
        const x = NetworkBuilder.xmlEscape;
        const {nodes, edges, fields} = network;
        const kinds = [...new Set(nodes.map(n => n.kind))];
        const palette = NetworkBuilder.palette(kinds);
        const layout = NetworkBuilder.initialLayout(nodes);

        const reserved = new Set(['label', 'kind', 'image', 'inm_imgdataurl']);
        const metaFields = fields.filter(f => !reserved.has(f));
        const attrs = ['kind', 'image', ...(includeDataUrl ? ['inm_imgdataurl'] : []), ...metaFields];

        const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        const degree = new Map();
        edges.forEach(e => {
            degree.set(e.source, (degree.get(e.source) || 0) + 1);
            degree.set(e.target, (degree.get(e.target) || 0) + 1);
        });

        const out = [];
        out.push('<?xml version="1.0" encoding="UTF-8"?>');
        out.push('<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" version="1.3">');
        out.push('  <meta><creator>ImgNetMaker</creator></meta>');
        out.push('  <graph defaultedgetype="undirected" mode="static">');
        out.push('    <attributes class="node" mode="static">');
        attrs.forEach(a => out.push(`      <attribute id="${x(a)}" title="${x(a)}" type="string"/>`));
        out.push('    </attributes>');
        out.push('    <attributes class="edge" mode="static"></attributes>');
        out.push('    <nodes>');
        nodes.forEach(n => {
            const values = {kind: n.kind};
            if (n.kind === 'image') {
                values.image = n.image;
                if (includeDataUrl && n.dataUrl) values.inm_imgdataurl = n.dataUrl;
                metaFields.forEach(f => {
                    if (n.attributes[f] !== undefined) values[f] = n.attributes[f];
                });
            }
            const [r, g, b] = hex(palette[n.kind] || '#BDBDBD');
            const size = 8 + 4 * Math.sqrt(degree.get(n.id) || 0);
            const pos = layout[n.id];
            out.push(`      <node id="${x(n.id)}" label="${x(n.label)}">`);
            out.push('        <attvalues>');
            Object.entries(values).forEach(([k, v]) => {
                out.push(`          <attvalue for="${x(k)}" value="${x(v)}"/>`);
            });
            out.push('        </attvalues>');
            out.push(`        <viz:color r="${r}" g="${g}" b="${b}"/>`);
            out.push(`        <viz:size value="${size.toFixed(2)}"/>`);
            out.push(`        <viz:position x="${pos.x.toFixed(2)}" y="${pos.y.toFixed(2)}" z="0"/>`);
            out.push('      </node>');
        });
        out.push('    </nodes>');
        out.push('    <edges>');
        edges.forEach((e, i) => {
            out.push(`      <edge id="e${i}" source="${x(e.source)}" target="${x(e.target)}" weight="${e.weight}"/>`);
        });
        out.push('    </edges>');
        out.push('  </graph>');
        out.push('</gexf>');
        return out.join('\n');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkBuilder;
}
