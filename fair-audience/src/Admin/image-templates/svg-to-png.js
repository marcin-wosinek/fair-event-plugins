/**
 * Convert a self-contained SVG string to a PNG blob using Canvas.
 *
 * @param {string} svgString SVG markup with images already base64-embedded
 * @return {Promise<Blob>} Promise resolving to PNG blob
 */
export function svgToPng(svgString) {
	return new Promise((resolve, reject) => {
		const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(svgBlob);

		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;

			const ctx = canvas.getContext('2d');
			ctx.drawImage(img, 0, 0);

			URL.revokeObjectURL(url);

			canvas.toBlob((blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('Canvas toBlob returned null'));
				}
			}, 'image/png');
		};

		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load SVG as image'));
		};

		img.src = url;
	});
}

/**
 * Trigger a browser download for the given blob.
 *
 * @param {Blob}   blob     The blob to download
 * @param {string} filename Suggested filename
 */
export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
