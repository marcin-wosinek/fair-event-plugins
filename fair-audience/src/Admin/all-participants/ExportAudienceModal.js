/**
 * Export the audience as CSV (#2218), after choosing who to include.
 *
 * Nothing downloads until "Download CSV" is pressed. The scope never follows
 * the table filters: it is every participant, or only the mailing
 * subscribers (confirmed members with the marketing mailing choice, the same
 * group the "In the mailing" statistic counts). The file is built from the response
 * and never stored on the server.
 *
 * @package FairAudience
 */

import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	RadioControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const MODAL_STYLE = {
	maxWidth: '560px',
	width: '100%',
	overflowWrap: 'anywhere',
};

export const SCOPE_ALL = 'all';
export const SCOPE_SUBSCRIBERS = 'subscribers';

/**
 * Save text as a file. The server's CSV already starts with a byte order
 * mark, so none is added here.
 *
 * @param {string} text     File contents.
 * @param {string} filename File name.
 */
export const downloadText = ( text, filename ) => {
	const blob = new Blob( [ text ], { type: 'text/csv;charset=utf-8' } );
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = filename;
	document.body.appendChild( link );
	link.click();
	link.remove();
	URL.revokeObjectURL( url );
};

/**
 * @param {Object}   props
 * @param {Function} props.onClose    Close the popup.
 * @param {Function} props.onExported Called with the success message after a download.
 * @return {Element} Popup.
 */
export default function ExportAudienceModal( { onClose, onExported } ) {
	const [ scope, setScope ] = useState( SCOPE_ALL );
	const [ isExporting, setIsExporting ] = useState( false );
	const [ error, setError ] = useState( null );
	// Refuses a second download before the first one re-rendered the popup.
	const inFlight = useRef( false );

	const close = () => {
		if ( ! inFlight.current ) {
			onClose();
		}
	};

	const download = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setIsExporting( true );
		setError( null );

		try {
			const response = await apiFetch( {
				path: `/fair-audience/v1/participants/export?scope=${ scope }`,
			} );
			downloadText( response.content, response.filename );
			inFlight.current = false;
			onExported(
				SCOPE_SUBSCRIBERS === scope
					? sprintf(
							/* translators: %d: number of mailing subscribers exported */
							_n(
								'Exported %d mailing subscriber.',
								'Exported %d mailing subscribers.',
								response.count,
								'fair-audience'
							),
							response.count
						)
					: sprintf(
							/* translators: %d: number of audience members exported */
							_n(
								'Exported %d audience member.',
								'Exported %d audience members.',
								response.count,
								'fair-audience'
							),
							response.count
						)
			);
			onClose();
		} catch ( err ) {
			inFlight.current = false;
			setIsExporting( false );
			setError(
				err?.message ||
					__(
						'The audience could not be exported. Please try again.',
						'fair-audience'
					)
			);
		}
	};

	return (
		<Modal
			title={ __( 'Export audience CSV', 'fair-audience' ) }
			onRequestClose={ close }
			isDismissible={ ! isExporting }
			shouldCloseOnEsc={ ! isExporting }
			shouldCloseOnClickOutside={ ! isExporting }
			style={ MODAL_STYLE }
		>
			<VStack spacing={ 4 }>
				<p>
					{ __(
						'The file can be imported on another Fair Audience site. It contains names, email addresses and phone numbers: keep it private.',
						'fair-audience'
					) }
				</p>

				<RadioControl
					label={ __( 'Who to export', 'fair-audience' ) }
					selected={ scope }
					disabled={ isExporting }
					options={ [
						{
							label: __( 'All participants', 'fair-audience' ),
							value: SCOPE_ALL,
							description: __(
								'Every participant, whatever the table is filtered to.',
								'fair-audience'
							),
						},
						{
							label: __(
								'Mailing subscribers only',
								'fair-audience'
							),
							value: SCOPE_SUBSCRIBERS,
							description: __(
								'Participants who confirmed their email address and chose to receive marketing mail, the group counted as “In the mailing”. The weekly summary opt-out and feed choices do not change who is included.',
								'fair-audience'
							),
						},
					] }
					onChange={ ( value ) => {
						setScope( value );
						setError( null );
					} }
				/>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				<HStack justify="flex-end" wrap>
					<Button
						variant="tertiary"
						onClick={ close }
						disabled={ isExporting }
					>
						{ __( 'Cancel', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ download }
						isBusy={ isExporting }
						disabled={ isExporting }
						accessibleWhenDisabled
					>
						{ isExporting
							? __( 'Downloading…', 'fair-audience' )
							: __( 'Download CSV', 'fair-audience' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
