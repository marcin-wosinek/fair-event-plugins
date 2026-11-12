/**
 * Export and import the audience as CSV (#2218), from the overflow menu in
 * the All Participants header. Both actions open a popup; nothing is
 * downloaded or uploaded until the popup's own button is pressed.
 *
 * @package FairAudience
 */

import { useState } from '@wordpress/element';
import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import ExportAudienceModal from './ExportAudienceModal.js';
import ImportAudienceModal from './ImportAudienceModal.js';

/**
 * @param {Object}   props
 * @param {Function} props.onMessage  Report a short success message.
 * @param {Function} props.onImported Called after an import that added members.
 * @return {Element} Menu and, while open, the export or import popup.
 */
export default function AudienceMigrationMenu( { onMessage, onImported } ) {
	const [ isExportOpen, setIsExportOpen ] = useState( false );
	const [ isImportOpen, setIsImportOpen ] = useState( false );

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
								setIsExportOpen( true );
							} }
							info={ __(
								'All participants or mailing subscribers only',
								'fair-audience'
							) }
						>
							{ __( 'Export audience CSV…', 'fair-audience' ) }
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

			{ isExportOpen && (
				<ExportAudienceModal
					onClose={ () => setIsExportOpen( false ) }
					onExported={ onMessage }
				/>
			) }

			{ isImportOpen && (
				<ImportAudienceModal
					onClose={ () => setIsImportOpen( false ) }
					onImported={ onImported }
				/>
			) }
		</>
	);
}
