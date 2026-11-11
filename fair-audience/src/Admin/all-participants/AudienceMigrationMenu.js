/**
 * Export and import the audience as CSV (#2218), from the overflow menu in
 * the All Participants header.
 *
 * The export covers every participant, whatever the table is filtered to,
 * and is downloaded straight from the response: nothing is stored on the
 * server.
 *
 * @package FairAudience
 */

import { useRef, useState } from '@wordpress/element';
import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';
import ImportAudienceModal from './ImportAudienceModal.js';

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
 * @param {Function} props.onMessage  Report a short success message.
 * @param {Function} props.onError    Report an error message.
 * @param {Function} props.onImported Called after an import that added members.
 * @return {Element} Menu and, while open, the import popup.
 */
export default function AudienceMigrationMenu( {
	onMessage,
	onError,
	onImported,
} ) {
	const [ isExporting, setIsExporting ] = useState( false );
	const [ isImportOpen, setIsImportOpen ] = useState( false );
	// Refuses a second export before the first one re-rendered the menu.
	const exporting = useRef( false );

	const exportCsv = async () => {
		if ( exporting.current ) {
			return;
		}
		exporting.current = true;
		setIsExporting( true );
		onError( null );

		try {
			const response = await apiFetch( {
				path: '/fair-audience/v1/participants/export',
			} );
			downloadText( response.content, response.filename );
			onMessage(
				sprintf(
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
		} catch ( err ) {
			onError(
				err?.message ||
					__(
						'The audience could not be exported. Please try again.',
						'fair-audience'
					)
			);
		} finally {
			exporting.current = false;
			setIsExporting( false );
		}
	};

	return (
		<>
			<DropdownMenu
				icon={ moreVertical }
				label={ __( 'Export or import the audience', 'fair-audience' ) }
				className="fair-audience-all-participants__migration-menu"
			>
				{ ( { onClose } ) => (
					<MenuGroup>
						<MenuItem
							onClick={ () => {
								onClose();
								exportCsv();
							} }
							disabled={ isExporting }
							info={ __(
								'Every participant, whatever the table shows',
								'fair-audience'
							) }
						>
							{ isExporting
								? __( 'Exporting…', 'fair-audience' )
								: __( 'Export audience CSV', 'fair-audience' ) }
						</MenuItem>
						<MenuItem
							onClick={ () => {
								onClose();
								setIsImportOpen( true );
							} }
							info={ __(
								'Add members from another Fair Audience site',
								'fair-audience'
							) }
						>
							{ __( 'Import audience CSV…', 'fair-audience' ) }
						</MenuItem>
					</MenuGroup>
				) }
			</DropdownMenu>

			{ isImportOpen && (
				<ImportAudienceModal
					onClose={ () => setIsImportOpen( false ) }
					onImported={ onImported }
				/>
			) }
		</>
	);
}
