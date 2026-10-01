/**
 * One comparison chart card: two events' cumulative series on a shared
 * event-relative timeline, with the legend that identifies them.
 *
 * @package FairEventsExperimental
 */

import { useId, useRef } from '@wordpress/element';
import { Button, Card, CardBody, CardHeader } from '@wordpress/components';
import { download } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import { EXPORT_IGNORE_ATTRIBUTE } from 'fair-events/src/Admin/event-statistics/exportChartImage.js';
import { SLOTS, getFutureHorizon } from './comparison.js';

export const SERIES_COLORS = {
	current: '#3858e9', // WordPress admin blue.
	comparison: '#b26200',
};

/**
 * The legend naming both events. Rendered as part of the card so it is
 * included in the exported image.
 *
 * @param {Object}  props           Props.
 * @param {Object}  props.labels    Event labels keyed by slot.
 * @param {boolean} props.hasFuture Whether any event still has days to come.
 * @return {JSX.Element} The legend.
 */
function ChartLegend( { labels, hasFuture } ) {
	const roles = {
		current: __( 'Current event', 'fair-events-experimental' ),
		comparison: __( 'Comparison event', 'fair-events-experimental' ),
	};
	return (
		<ul className="fair-compare-events__legend">
			{ SLOTS.map( ( slot ) => (
				<li key={ slot } className="fair-compare-events__legend-item">
					<span
						className="fair-compare-events__swatch"
						style={ { borderTopColor: SERIES_COLORS[ slot ] } }
						aria-hidden="true"
					/>
					<span className="fair-compare-events__legend-text">
						<span className="fair-compare-events__legend-role">
							{ roles[ slot ] }
						</span>
						<strong>{ labels[ slot ] }</strong>
					</span>
				</li>
			) ) }
			{ hasFuture && (
				<li className="fair-compare-events__legend-item">
					<span
						className="fair-compare-events__swatch is-future"
						aria-hidden="true"
					/>
					<span className="fair-compare-events__legend-text">
						{ __(
							'Dashed line: days that have not happened yet, so no sales are recorded for them.',
							'fair-events-experimental'
						) }
					</span>
				</li>
			) }
		</ul>
	);
}

/**
 * A comparison chart card with its download action.
 *
 * @param {Object}   props                    Props.
 * @param {string}   props.title              Chart title.
 * @param {Array}    props.rows               Rows from alignSeries().
 * @param {Object}   props.labels             Event labels keyed by slot.
 * @param {boolean}  props.allowDecimals      Whether the value axis shows decimals.
 * @param {Function} [props.valueFormatter]   Formats axis and tooltip values.
 * @param {Function} props.onDownload         Called with the card element.
 * @param {boolean}  props.isDownloadDisabled Whether the download is unavailable.
 * @param {boolean}  props.isDownloading      Whether this chart is being exported.
 * @return {JSX.Element} The chart card.
 */
export default function ComparisonChart( {
	title,
	rows,
	labels,
	allowDecimals,
	valueFormatter,
	onDownload,
	isDownloadDisabled,
	isDownloading,
} ) {
	const cardRef = useRef( null );
	const headingId = useId();
	const horizons = {};
	SLOTS.forEach( ( slot ) => {
		horizons[ slot ] = getFutureHorizon( rows, slot );
	} );

	return (
		<Card ref={ cardRef } className="fair-compare-events__chart-card">
			<CardHeader className="fair-compare-events__chart-header">
				<h2
					id={ headingId }
					className="fair-compare-events__chart-title"
				>
					{ title }
				</h2>
				<Button
					{ ...{ [ EXPORT_IGNORE_ATTRIBUTE ]: 'true' } }
					className="fair-compare-events__download"
					variant="secondary"
					size="compact"
					icon={ download }
					isBusy={ isDownloading }
					accessibleWhenDisabled
					disabled={ isDownloadDisabled }
					aria-describedby={ headingId }
					onClick={ () => onDownload( cardRef.current ) }
				>
					{ __( 'Download PNG', 'fair-events-experimental' ) }
				</Button>
			</CardHeader>
			<CardBody>
				<ChartLegend
					labels={ labels }
					hasFuture={ SLOTS.some( ( slot ) => horizons[ slot ] ) }
				/>
				<ResponsiveContainer width="100%" height={ 300 }>
					<LineChart data={ rows } margin={ { left: 8, right: 24 } }>
						<CartesianGrid strokeDasharray="3 3" />
						<XAxis
							dataKey="label"
							interval="preserveStartEnd"
							minTickGap={ 48 }
						/>
						<YAxis
							allowDecimals={ allowDecimals }
							tickFormatter={ valueFormatter }
						/>
						<Tooltip formatter={ valueFormatter } filterNull />
						{ SLOTS.map( ( slot ) => (
							<Line
								key={ slot }
								type="monotone"
								dataKey={ slot }
								name={ labels[ slot ] }
								stroke={ SERIES_COLORS[ slot ] }
								strokeWidth={ 2 }
								dot={ false }
								connectNulls={ false }
								isAnimationActive={ false }
							/>
						) ) }
						{ SLOTS.map(
							( slot ) =>
								horizons[ slot ] && (
									<ReferenceLine
										key={ slot }
										segment={ horizons[ slot ] }
										stroke={ SERIES_COLORS[ slot ] }
										strokeDasharray="5 5"
									/>
								)
						) }
					</LineChart>
				</ResponsiveContainer>
			</CardBody>
		</Card>
	);
}
