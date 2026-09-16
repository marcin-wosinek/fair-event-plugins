/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { TextareaControl } from '@wordpress/components';

/**
 * Reason input shown beside a save action that requires an audit reason.
 *
 * Validation is enforced by the caller (typically by disabling its Save
 * button while the trimmed value is empty) and again by the REST
 * controller — this component only surfaces the requirement inline.
 *
 * @param {Object}   props          Props
 * @param {string}   props.value    Current reason text
 * @param {Function} props.onChange Called with the new reason text
 * @param {string}   [props.label]  Optional label override
 * @return {JSX.Element} The reason field
 */
export default function ReasonField( {
	value,
	onChange,
	label = __( 'Reason for this change', 'fair-payments-connector' ),
} ) {
	return (
		<div style={ { marginTop: '12px', maxWidth: '480px' } }>
			<TextareaControl
				__nextHasNoMarginBottom
				label={ label }
				help={ __(
					'Required. Recorded in the audit log with this change.',
					'fair-payments-connector'
				) }
				value={ value }
				onChange={ onChange }
				rows={ 2 }
			/>
		</div>
	);
}
