/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

const BAR_WIDTH = 24;
const BAR_GAP = 8;
const GROUP_GAP = 24;
const CHART_HEIGHT = 160;
const LABEL_HEIGHT = 40;
const SVG_PADDING = 20;

const formatAmount = (amount) =>
	new Intl.NumberFormat(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);

const TagChart = ({ data }) => {
	if (!data || Object.keys(data).length === 0) {
		return null;
	}

	const tags = Object.keys(data).filter((key) => key !== 'untagged');
	if (data.untagged) {
		tags.push('untagged');
	}

	const maxValue = Math.max(
		...tags.flatMap((tag) => [
			data[tag].total_cost || 0,
			data[tag].total_income || 0,
		]),
		1
	);

	const groupWidth = BAR_WIDTH * 2 + BAR_GAP;
	const totalWidth =
		tags.length * groupWidth +
		(tags.length - 1) * GROUP_GAP +
		SVG_PADDING * 2;
	const svgHeight = CHART_HEIGHT + LABEL_HEIGHT + SVG_PADDING;

	return (
		<div>
			<h3 style={{ fontSize: '14px', marginBottom: '8px' }}>
				{__('Income vs. Expense by Tag', 'fair-finance')}
			</h3>
			<div style={{ overflowX: 'auto' }}>
				<svg
					width={totalWidth}
					height={svgHeight}
					aria-label={__('Tag chart', 'fair-finance')}
				>
					{tags.map((tag, i) => {
						const groupX =
							SVG_PADDING + i * (groupWidth + GROUP_GAP);
						const cost = data[tag].total_cost || 0;
						const income = data[tag].total_income || 0;
						const costHeight = Math.round(
							(cost / maxValue) * CHART_HEIGHT
						);
						const incomeHeight = Math.round(
							(income / maxValue) * CHART_HEIGHT
						);

						return (
							<g key={tag}>
								{/* Cost bar */}
								<rect
									x={groupX}
									y={CHART_HEIGHT - costHeight + SVG_PADDING}
									width={BAR_WIDTH}
									height={costHeight}
									fill="#cc1818"
									opacity="0.85"
								>
									<title>
										{tag} {__('cost', 'fair-finance')}:{' '}
										{formatAmount(cost)}
									</title>
								</rect>
								{/* Income bar */}
								<rect
									x={groupX + BAR_WIDTH + BAR_GAP}
									y={
										CHART_HEIGHT -
										incomeHeight +
										SVG_PADDING
									}
									width={BAR_WIDTH}
									height={incomeHeight}
									fill="#1e7e34"
									opacity="0.85"
								>
									<title>
										{tag} {__('income', 'fair-finance')}:{' '}
										{formatAmount(income)}
									</title>
								</rect>
								{/* Tag label */}
								<text
									x={groupX + groupWidth / 2}
									y={CHART_HEIGHT + SVG_PADDING + 16}
									textAnchor="middle"
									fontSize="11"
									fill="#333"
								>
									{tag.length > 10
										? tag.substring(0, 9) + '…'
										: tag}
								</text>
							</g>
						);
					})}
					{/* Legend */}
					<rect
						x={SVG_PADDING}
						y={svgHeight - 18}
						width={10}
						height={10}
						fill="#cc1818"
						opacity="0.85"
					/>
					<text
						x={SVG_PADDING + 14}
						y={svgHeight - 10}
						fontSize="11"
						fill="#333"
					>
						{__('Cost', 'fair-finance')}
					</text>
					<rect
						x={SVG_PADDING + 60}
						y={svgHeight - 18}
						width={10}
						height={10}
						fill="#1e7e34"
						opacity="0.85"
					/>
					<text
						x={SVG_PADDING + 74}
						y={svgHeight - 10}
						fontSize="11"
						fill="#333"
					>
						{__('Income', 'fair-finance')}
					</text>
				</svg>
			</div>
		</div>
	);
};

export default TagChart;
