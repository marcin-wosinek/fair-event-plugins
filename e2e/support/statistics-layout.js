/**
 * Layout checks for the Event Statistics view (#2114), shared by the
 * Statistics specs so the shared tests site and the fresh installs are held
 * to the same geometry.
 */

import { expect } from '@playwright/test';

export const STATISTICS_VIEWPORTS = [
	{ name: 'desktop', width: 1280, height: 900, paired: true },
	{ name: 'tablet', width: 768, height: 1024, paired: false },
	{ name: 'mobile', width: 375, height: 812, paired: false },
];

/**
 * Measure the Statistics layout on the current page.
 *
 * @param {import('@playwright/test').Page} page Page showing Statistics.
 * @return {Promise<Object>} Pair, capacity and activity-label geometry.
 */
export function measureStatisticsLayout(page) {
	return page.evaluate(() => {
		const box = (element) => element.getBoundingClientRect();
		const contentWidth = (element) => {
			const style = getComputedStyle(element);
			return (
				element.clientWidth -
				parseFloat(style.paddingLeft) -
				parseFloat(style.paddingRight)
			);
		};
		const pairs = [
			...document.querySelectorAll('.fair-event-statistics__chart-pair'),
		].map((pair) =>
			[...pair.children].map((card) => {
				const { left, top, bottom, width } = box(card);
				return { left, top, bottom, width };
			})
		);
		const capacityBars = [
			...document.querySelectorAll(
				'.fair-event-statistics__capacity-bar'
			),
		].map((bar) => ({
			width: box(bar).width,
			available: contentWidth(bar.closest('.components-card__body')),
		}));
		const activityChart = document.querySelector(
			'.fair-event-statistics__activity-chart'
		);
		const svg = activityChart?.querySelector('svg');
		const labels = activityChart
			? [...activityChart.querySelectorAll('text[text-anchor="end"]')]
					.filter((text) => text.querySelector('tspan'))
					.map((text) => ({
						text: [...text.querySelectorAll('tspan')]
							.map((line) => line.textContent)
							.join(' '),
						lines: text.querySelectorAll('tspan').length,
						left: box(text).left - box(svg).left,
						top: box(text).top,
						bottom: box(text).bottom,
					}))
			: [];
		return {
			pairs,
			capacityBars,
			labels,
			scrollWidth: document.documentElement.scrollWidth,
			viewportWidth: document.documentElement.clientWidth,
		};
	});
}

/**
 * Check the Statistics layout against the viewport it is shown at.
 *
 * @param {import('@playwright/test').Page} page     Page showing Statistics.
 * @param {Object}                          viewport One of STATISTICS_VIEWPORTS.
 * @return {Promise<Object>} The measured layout, for further checks.
 */
export async function expectStatisticsLayout(page, viewport) {
	// Wait for the measured activity chart (or its empty state) to settle.
	await expect(
		page.locator('.fair-event-statistics__chart-pair')
	).toHaveCount(2);
	await page.waitForTimeout(500);
	const layout = await measureStatisticsLayout(page);

	// No horizontal page scrolling.
	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);

	// The sales pair and the activity pair share one grid: paired columns of
	// equal width side by side on wide screens, stacked otherwise.
	const [sales, activity] = layout.pairs;
	expect(sales).toHaveLength(2);
	expect(activity).toHaveLength(2);
	for (const pair of [sales, activity]) {
		if (viewport.paired) {
			expect(Math.abs(pair[0].width - pair[1].width)).toBeLessThan(1);
			expect(Math.abs(pair[0].top - pair[1].top)).toBeLessThan(1);
			expect(pair[1].left).toBeGreaterThan(pair[0].left);
		} else {
			expect(pair[1].top).toBeGreaterThanOrEqual(pair[0].bottom);
		}
	}
	for (const index of [0, 1]) {
		expect(Math.abs(sales[index].left - activity[index].left)).toBeLessThan(
			1
		);
		expect(
			Math.abs(sales[index].width - activity[index].width)
		).toBeLessThan(1);
	}

	// Capacity bars span their card body.
	expect(layout.capacityBars.length).toBeGreaterThan(0);
	for (const bar of layout.capacityBars) {
		expect(bar.width).toBeGreaterThanOrEqual(bar.available - 1);
	}

	// Activity names on the chart are neither clipped nor overlapping.
	const labels = [...layout.labels].sort((a, b) => a.top - b.top);
	for (const [index, label] of labels.entries()) {
		expect(label.left).toBeGreaterThanOrEqual(0);
		if (index > 0) {
			expect(label.top).toBeGreaterThanOrEqual(labels[index - 1].bottom);
		}
	}
	return layout;
}
