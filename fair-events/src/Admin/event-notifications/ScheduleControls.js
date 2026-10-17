/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { SelectControl, TextControl } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { DAYS, WEEK_SCOPES } from './shared.js';

/**
 * When a channel sends and which week it covers. Controlled like
 * EmailContentControls and rendered inside a channel's field grid.
 *
 * @param {Object}   props
 * @param {Object}   props.values             Current values.
 * @param {number}   props.values.day_of_week ISO day of the week, 1 = Monday.
 * @param {string}   props.values.time_of_day Time in the site timezone, HH:MM.
 * @param {string}   props.values.week_scope  Which week a send covers.
 * @param {string}   props.weekHelp           Help for the week selection.
 * @param {Function} props.onChange           Receives the field name and its new value.
 * @return {JSX.Element} The controls.
 */
export default function ScheduleControls( { values, weekHelp, onChange } ) {
	return (
		<>
			<SelectControl
				label={ __( 'Send on', 'fair-events' ) }
				value={ String( values.day_of_week ) }
				options={ DAYS }
				onChange={ ( value ) =>
					onChange( 'day_of_week', parseInt( value, 10 ) )
				}
			/>

			<TextControl
				type="time"
				label={ __( 'Send at', 'fair-events' ) }
				value={ values.time_of_day }
				onChange={ ( value ) => onChange( 'time_of_day', value ) }
			/>

			<SelectControl
				className="is-wide"
				label={ __( 'Which week to include', 'fair-events' ) }
				help={ weekHelp }
				value={ values.week_scope }
				options={ WEEK_SCOPES }
				onChange={ ( value ) => onChange( 'week_scope', value ) }
			/>
		</>
	);
}
