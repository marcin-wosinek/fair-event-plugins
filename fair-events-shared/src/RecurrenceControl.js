/**
 * Shared RecurrenceControl component
 */

import {
	CheckboxControl,
	SelectControl,
	TextControl,
	__experimentalNumberControl as NumberControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { RECURRENCE_FREQUENCIES, RECURRENCE_END_TYPES } from './recurrence.js';

/**
 * Controlled "Repeat this event" checkbox plus, when enabled, the
 * Frequency / Ends / Count / Until fields. Hosts own the surrounding
 * layout (Card, calendar, gating) and the `recurrence` state object.
 *
 * @param {Object}   props
 * @param {Object}   props.value                Recurrence state: { enabled, frequency, endType, count, until }.
 * @param {Function} props.onChange             Callback receiving the merged recurrence object.
 * @param {boolean}  [props.hideToggle]         When true, omit the "Repeat this event" checkbox and always show the fields (for hosts like SeriesModal where recurrence is implicitly on).
 * @return {JSX.Element} The RecurrenceControl component.
 */
export default function RecurrenceControl({
	value,
	onChange,
	hideToggle = false,
}) {
	const { enabled, frequency, endType, count, until } = value;

	const update = (changes) => onChange({ ...value, ...changes });

	return (
		<VStack spacing={2}>
			{!hideToggle && (
				<CheckboxControl
					label={__('Repeat this event', 'fair-events')}
					checked={enabled}
					onChange={(checked) => update({ enabled: checked })}
				/>
			)}

			{(hideToggle || enabled) && (
				<VStack spacing={2}>
					<SelectControl
						label={__('Frequency', 'fair-events')}
						value={frequency}
						options={RECURRENCE_FREQUENCIES}
						onChange={(newFrequency) =>
							update({ frequency: newFrequency })
						}
					/>
					<SelectControl
						label={__('Ends', 'fair-events')}
						value={endType}
						options={RECURRENCE_END_TYPES}
						onChange={(newEndType) =>
							update({ endType: newEndType })
						}
					/>
					{endType === 'count' && (
						<NumberControl
							label={__('Number of occurrences', 'fair-events')}
							value={count}
							onChange={(val) =>
								update({ count: parseInt(val, 10) || 1 })
							}
							min={1}
							max={365}
						/>
					)}
					{endType === 'until' && (
						<TextControl
							label={__('End date', 'fair-events')}
							type="date"
							value={until}
							onChange={(newUntil) => update({ until: newUntil })}
						/>
					)}
				</VStack>
			)}
		</VStack>
	);
}
