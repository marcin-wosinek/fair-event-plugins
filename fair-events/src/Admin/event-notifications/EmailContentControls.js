/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	TextareaControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Wording controls shared by the email channels: the empty-week switch, the
 * subject and the text around the list of events.
 *
 * Controlled: it holds no state of its own. Each channel passes its own
 * values and receives its own changes, so editing or saving one channel never
 * touches another. Rendered inside a channel's field grid.
 *
 * @param {Object}   props
 * @param {Object}   props.values            Current values.
 * @param {boolean}  props.values.skip_empty Whether an empty week sends nothing.
 * @param {string}   props.values.subject    Subject, with optional placeholders.
 * @param {string}   props.values.intro      Text above the list of events.
 * @param {string}   props.values.outro      Text below the list of events.
 * @param {Function} props.onChange          Receives the field name and its new value.
 * @return {JSX.Element} The controls.
 */
export default function EmailContentControls( { values, onChange } ) {
	const update = ( field ) => ( value ) => onChange( field, value );

	return (
		<>
			<ToggleControl
				className="is-wide"
				label={ __(
					'Skip the email when the week has no events',
					'fair-events'
				) }
				checked={ !! values.skip_empty }
				onChange={ update( 'skip_empty' ) }
			/>

			<TextControl
				className="is-wide"
				label={ __( 'Subject', 'fair-events' ) }
				help={ __(
					'Use {week_start} and {week_end} to insert the week’s dates.',
					'fair-events'
				) }
				value={ values.subject }
				onChange={ update( 'subject' ) }
			/>

			<TextareaControl
				className="is-wide"
				label={ __( 'Text above the list of events', 'fair-events' ) }
				help={ __(
					'Optional. Basic HTML such as links and bold text is allowed.',
					'fair-events'
				) }
				value={ values.intro }
				onChange={ update( 'intro' ) }
				rows={ 4 }
			/>

			<TextareaControl
				className="is-wide"
				label={ __( 'Text below the list of events', 'fair-events' ) }
				help={ __(
					'Optional. Basic HTML such as links and bold text is allowed.',
					'fair-events'
				) }
				value={ values.outro }
				onChange={ update( 'outro' ) }
				rows={ 4 }
			/>
		</>
	);
}
