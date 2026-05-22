/**
 * Anchor + Offset Picker
 *
 * Composes an anchor type (event date start/end), which event date to anchor
 * to (when the event has several), and a signed offset (value + unit +
 * before/after) into the `{ anchor_type, anchor_ref_id, offset_minutes }` the
 * scheduled-messages API expects. Shows the resulting send time as a preview.
 *
 * @package FairEvents
 */

import { SelectControl, RadioControl } from '@wordpress/components';
import {
	__experimentalNumberControl as NumberControl,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

const UNIT_MINUTES = {
	minutes: 1,
	hours: 60,
	days: 1440,
};

/**
 * Convert a value/unit/direction triple to signed offset minutes.
 *
 * @param {number} value     Offset magnitude.
 * @param {string} unit      'minutes' | 'hours' | 'days'.
 * @param {string} direction 'before' | 'after'.
 * @return {number} Signed offset in minutes.
 */
export function toOffsetMinutes(value, unit, direction) {
	const magnitude = Math.abs(parseInt(value, 10) || 0) * UNIT_MINUTES[unit];
	return direction === 'before' ? -magnitude : magnitude;
}

/**
 * Decompose signed offset minutes back into value/unit/direction, choosing the
 * largest unit that divides evenly.
 *
 * @param {number} offsetMinutes Signed offset in minutes.
 * @return {{value: number, unit: string, direction: string}} The triple.
 */
export function fromOffsetMinutes(offsetMinutes) {
	const direction = offsetMinutes < 0 ? 'before' : 'after';
	const abs = Math.abs(offsetMinutes);
	let unit = 'minutes';
	if (abs !== 0 && abs % UNIT_MINUTES.days === 0) {
		unit = 'days';
	} else if (abs !== 0 && abs % UNIT_MINUTES.hours === 0) {
		unit = 'hours';
	}
	return { value: abs / UNIT_MINUTES[unit], unit, direction };
}

/**
 * Compute the send time for a preview (best-effort, treats the stored datetime
 * as wall-clock time — the server recomputes authoritatively).
 *
 * @param {Object} eventDate     Event date row with start_datetime/end_datetime.
 * @param {string} anchorType    'event_date_start' | 'event_date_end'.
 * @param {number} offsetMinutes Signed offset in minutes.
 * @return {string} Formatted local datetime, or '' when unavailable.
 */
export function computeScheduledFor(eventDate, anchorType, offsetMinutes) {
	if (!eventDate) {
		return '';
	}
	const base =
		anchorType === 'event_date_end'
			? eventDate.end_datetime
			: eventDate.start_datetime;
	if (!base) {
		return '';
	}
	const dt = new Date(base.replace(' ', 'T'));
	if (Number.isNaN(dt.getTime())) {
		return '';
	}
	dt.setMinutes(dt.getMinutes() + offsetMinutes);
	const pad = (n) => String(n).padStart(2, '0');
	return (
		`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
		`${pad(dt.getHours())}:${pad(dt.getMinutes())}`
	);
}

/**
 * Anchor + offset picker.
 *
 * @param {Object}   props            Component props.
 * @param {Array}    props.eventDates  Event dates available as anchors.
 * @param {string}   props.anchorType  Selected anchor type.
 * @param {number}   props.anchorRefId Selected event date ID.
 * @param {number}   props.offsetValue Offset magnitude.
 * @param {string}   props.offsetUnit  Offset unit.
 * @param {string}   props.direction   'before' | 'after'.
 * @param {Function} props.onChange    Called with the changed field map.
 * @param {boolean}  props.disabled    Whether inputs are disabled.
 * @return {JSX.Element} The picker.
 */
export default function AnchorOffsetPicker({
	eventDates,
	anchorType,
	anchorRefId,
	offsetValue,
	offsetUnit,
	direction,
	onChange,
	disabled,
}) {
	const selectedDate = eventDates.find((d) => d.id === anchorRefId);
	const offsetMinutes = toOffsetMinutes(offsetValue, offsetUnit, direction);
	const preview = computeScheduledFor(
		selectedDate,
		anchorType,
		offsetMinutes
	);

	return (
		<div style={{ marginBottom: '16px' }}>
			<SelectControl
				label={__('Anchor', 'fair-events')}
				value={anchorType}
				options={[
					{
						label: __('Event date start', 'fair-events'),
						value: 'event_date_start',
					},
					{
						label: __('Event date end', 'fair-events'),
						value: 'event_date_end',
					},
				]}
				onChange={(value) => onChange({ anchorType: value })}
				disabled={disabled}
				__nextHasNoMarginBottom
			/>

			{eventDates.length > 1 && (
				<SelectControl
					label={__('Which date', 'fair-events')}
					value={String(anchorRefId)}
					options={eventDates.map((d) => ({
						label: d.display_label || `#${d.id}`,
						value: String(d.id),
					}))}
					onChange={(value) =>
						onChange({ anchorRefId: parseInt(value, 10) })
					}
					disabled={disabled}
					__nextHasNoMarginBottom
				/>
			)}

			<HStack
				alignment="flex-end"
				spacing={3}
				style={{ marginTop: '8px' }}
			>
				<NumberControl
					label={__('Offset', 'fair-events')}
					min={0}
					value={offsetValue}
					onChange={(value) =>
						onChange({ offsetValue: parseInt(value, 10) || 0 })
					}
					disabled={disabled}
					__nextHasNoMarginBottom
				/>
				<SelectControl
					label={__('Unit', 'fair-events')}
					value={offsetUnit}
					options={[
						{
							label: __('minutes', 'fair-events'),
							value: 'minutes',
						},
						{ label: __('hours', 'fair-events'), value: 'hours' },
						{ label: __('days', 'fair-events'), value: 'days' },
					]}
					onChange={(value) => onChange({ offsetUnit: value })}
					disabled={disabled}
					__nextHasNoMarginBottom
				/>
				<RadioControl
					selected={direction}
					options={[
						{ label: __('before', 'fair-events'), value: 'before' },
						{ label: __('after', 'fair-events'), value: 'after' },
					]}
					onChange={(value) => onChange({ direction: value })}
				/>
			</HStack>

			<p style={{ marginTop: '8px', color: '#666' }}>
				{preview
					? sprintf(
							/* translators: %s: computed send date/time */
							__('Will send around: %s', 'fair-events'),
							preview
					  )
					: __(
							'Send time will be computed from the chosen date.',
							'fair-events'
					  )}
			</p>
		</div>
	);
}
