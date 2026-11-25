/**
 * Marketing assets - Manage Event tab
 *
 * Lists the marketing assets of this date and edits one at a time: a use
 * case, plain text, an optional image and links to the team and schedule.
 * An unsaved edit is parked with the host page while another tab is open.
 *
 * @package FairEventsExperimental
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardBody,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';
import CopyUrlButton from '../components/CopyUrlButton.js';
import AssetEditor from './AssetEditor.js';
import {
	emptyForm,
	formFromAsset,
	hasMeaningfulText,
	isFormDirty,
	memberName,
	toPayload,
} from './assetsModel.js';

export const TAB_NAME = 'marketing-assets';

const PER_PAGE = 100;

const basePath = ( eventDateId ) =>
	`/fair-events/v1/event-dates/${ eventDateId }/marketing-assets`;

const labelOf = ( asset ) =>
	asset.label?.trim() || __( '(no use case)', 'fair-events-experimental' );

/**
 * Editor state for an asset (or a new one).
 *
 * @param {Object|null} asset Stored asset, null for a new one.
 * @return {Object} Editor state.
 */
const startEditing = ( asset ) => {
	const form = asset ? formFromAsset( asset ) : emptyForm();
	return {
		assetId: asset ? asset.id : null,
		form,
		original: form,
		imageRemoved: !! asset?.image_removed,
		linkedMembers: asset?.members || [],
		linkedScheduleItem: asset?.schedule_item || null,
	};
};

export default function MarketingAssets( {
	eventDateId,
	setTabDirty,
	getTabDraft,
	setTabDraft,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	const [ options, setOptions ] = useState( null );
	const [ assets, setAssets ] = useState( [] );
	const [ total, setTotal ] = useState( 0 );
	const [ page, setPage ] = useState( 1 );
	const [ loadingMore, setLoadingMore ] = useState( false );
	const [ editing, setEditing ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const deletion = useConfirmAction();

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setLoadError( null );
		Promise.all( [
			apiFetch( { path: `${ basePath( eventDateId ) }/options` } ),
			apiFetch( {
				path: `${ basePath( eventDateId ) }?per_page=${ PER_PAGE }&page=1`,
			} ),
		] )
			.then( ( [ loadedOptions, list ] ) => {
				if ( cancelled ) {
					return;
				}
				setOptions( loadedOptions );
				setAssets( list.items || [] );
				setTotal( list.total || 0 );
				setPage( 1 );
				const draft = getTabDraft?.( TAB_NAME );
				if ( draft?.editing ) {
					const stillThere =
						null === draft.editing.assetId ||
						( list.items || [] ).some(
							( asset ) => asset.id === draft.editing.assetId
						);
					if ( stillThere ) {
						setEditing( draft.editing );
					}
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The marketing assets could not be loaded.',
								'fair-events-experimental'
							)
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setLoading( false );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ eventDateId, getTabDraft, reloadKey ] );

	const dirty = !! editing && isFormDirty( editing.form, editing.original );

	useEffect( () => {
		setTabDirty?.( TAB_NAME, dirty );
	}, [ dirty, setTabDirty ] );

	useEffect( () => {
		if ( loading ) {
			return;
		}
		setTabDraft?.( TAB_NAME, dirty ? { editing } : undefined );
	}, [ loading, dirty, editing, setTabDraft ] );

	const loadMore = useCallback( async () => {
		setLoadingMore( true );
		try {
			const list = await apiFetch( {
				path: `${ basePath( eventDateId ) }?per_page=${ PER_PAGE }&page=${
					page + 1
				}`,
			} );
			setAssets( ( prev ) => [ ...prev, ...( list.items || [] ) ] );
			setTotal( list.total || 0 );
			setPage( page + 1 );
		} catch ( err ) {
			setNotice( {
				status: 'error',
				message:
					err?.message ||
					__(
						'More assets could not be loaded. Try again.',
						'fair-events-experimental'
					),
			} );
		} finally {
			setLoadingMore( false );
		}
	}, [ eventDateId, page ] );

	if ( loading ) {
		return (
			<Card style={ { marginTop: '16px' } }>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	if ( loadError ) {
		return (
			<div style={ { marginTop: '16px' } }>
				<Notice status="error" isDismissible={ false }>
					{ loadError }{ ' ' }
					<Button
						variant="link"
						onClick={ () => setReloadKey( ( key ) => key + 1 ) }
					>
						{ __( 'Try again', 'fair-events-experimental' ) }
					</Button>
				</Notice>
			</div>
		);
	}

	const open = ( asset ) => {
		setNotice( null );
		setSaveError( null );
		setEditing( startEditing( asset ) );
	};

	const close = () => {
		setSaveError( null );
		setEditing( null );
	};

	const save = async () => {
		if ( saving || ! editing ) {
			return;
		}
		setSaving( true );
		setSaveError( null );
		const isNew = null === editing.assetId;
		try {
			const saved = await apiFetch( {
				path: isNew
					? basePath( eventDateId )
					: `${ basePath( eventDateId ) }/${ editing.assetId }`,
				method: isNew ? 'POST' : 'PATCH',
				data: toPayload(
					editing.form,
					isNew ? null : editing.original
				),
			} );
			setAssets( ( prev ) =>
				isNew
					? [ ...prev, saved ]
					: prev.map( ( asset ) =>
							asset.id === saved.id ? saved : asset
						)
			);
			if ( isNew ) {
				setTotal( ( count ) => count + 1 );
			}
			setEditing( null );
			setNotice( {
				status: 'success',
				message: isNew
					? sprintf(
							/* translators: %s: asset use case */
							__( 'Created %s.', 'fair-events-experimental' ),
							labelOf( saved )
						)
					: sprintf(
							/* translators: %s: asset use case */
							__( 'Saved %s.', 'fair-events-experimental' ),
							labelOf( saved )
						),
			} );
		} catch ( err ) {
			// The editor stays open with everything as typed.
			setSaveError( {
				message:
					err?.message ||
					__(
						'The asset could not be saved. Your changes are still here — try again.',
						'fair-events-experimental'
					),
				params: err?.data?.params || {},
			} );
		} finally {
			setSaving( false );
		}
	};

	const confirmDelete = () =>
		deletion.run(
			async ( asset ) => {
				await apiFetch( {
					path: `${ basePath( eventDateId ) }/${ asset.id }`,
					method: 'DELETE',
				} );
				setAssets( ( prev ) =>
					prev.filter( ( other ) => other.id !== asset.id )
				);
				setTotal( ( count ) => Math.max( 0, count - 1 ) );
				if ( editing?.assetId === asset.id ) {
					setEditing( null );
				}
				setNotice( {
					status: 'success',
					message: asset.image
						? sprintf(
								/* translators: %s: asset use case */
								__(
									'Deleted %s. Its image stays in the Media Library.',
									'fair-events-experimental'
								),
								labelOf( asset )
							)
						: sprintf(
								/* translators: %s: asset use case */
								__( 'Deleted %s.', 'fair-events-experimental' ),
								labelOf( asset )
							),
				} );
			},
			__(
				'The asset could not be deleted. Try again.',
				'fair-events-experimental'
			)
		);

	const editorOpen = !! editing;

	const renderEditor = ( key = 'new' ) => (
		<AssetEditor
			key={ key }
			form={ editing.form }
			original={ editing.original }
			isNew={ null === editing.assetId }
			imageRemoved={ editing.imageRemoved }
			options={ options }
			linkedMembers={ editing.linkedMembers }
			linkedScheduleItem={ editing.linkedScheduleItem }
			saving={ saving }
			error={ saveError }
			onChange={ ( form ) => setEditing( { ...editing, form } ) }
			onMediaUnavailable={ () =>
				setSaveError( {
					message: __(
						'The Media Library could not be opened. Reload the page and try again.',
						'fair-events-experimental'
					),
				} )
			}
			onSave={ save }
			onCancel={ close }
		/>
	);

	return (
		<VStack
			spacing={ 4 }
			className="fair-events-marketing"
			style={ { marginTop: '16px' } }
		>
			<Card>
				<CardBody>
					<div className="fair-events-marketing-intro">
						<div>
							<h2>
								{ __(
									'Marketing assets',
									'fair-events-experimental'
								) }
							</h2>
							<p>
								{ __(
									'Text and images for promoting this date. They belong to this date only: other dates of a series have their own.',
									'fair-events-experimental'
								) }
							</p>
							<p>
								{ __(
									'Everything here is public on this date’s marketing assets page as soon as it is saved, even before the event is published. Share the page with the people who help you promote it: they need no account.',
									'fair-events-experimental'
								) }
							</p>
							{ options.share_url && (
								<div className="fair-events-marketing-buttons">
									<Button
										variant="link"
										href={ options.share_url }
										target="_blank"
										rel="noopener noreferrer"
									>
										{ __(
											'Open public page',
											'fair-events-experimental'
										) }
									</Button>
									<CopyUrlButton
										url={ options.share_url }
										label={ __(
											'Copy public page link',
											'fair-events-experimental'
										) }
									/>
									{ options.index_url && (
										<Button
											variant="link"
											href={ options.index_url }
											target="_blank"
											rel="noopener noreferrer"
										>
											{ __(
												'All events’ public pages',
												'fair-events-experimental'
											) }
										</Button>
									) }
								</div>
							) }
						</div>
						<Button
							variant="primary"
							onClick={ () => open( null ) }
							disabled={ editorOpen }
							accessibleWhenDisabled
						>
							{ __( 'Add asset', 'fair-events-experimental' ) }
						</Button>
					</div>
					{ editorOpen && (
						<p className="fair-events-marketing-hint">
							{ __(
								'Save or cancel the open asset to add or edit another one.',
								'fair-events-experimental'
							) }
						</p>
					) }
				</CardBody>
			</Card>

			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			{ editing && null === editing.assetId && renderEditor() }

			{ assets.length === 0 && ! editorOpen && (
				<Card>
					<CardBody>
						<p className="fair-events-marketing-empty">
							{ __(
								'No marketing assets for this date yet. Add one for each place you promote it, such as an Instagram post or a WhatsApp status.',
								'fair-events-experimental'
							) }
						</p>
					</CardBody>
				</Card>
			) }

			{ assets.map( ( asset ) =>
				editing?.assetId === asset.id ? (
					renderEditor( asset.id )
				) : (
					<AssetCard
						key={ asset.id }
						asset={ asset }
						actionsDisabled={ editorOpen }
						onEdit={ () => open( asset ) }
						onDelete={ () => deletion.open( asset ) }
					/>
				)
			) }

			{ assets.length < total && (
				<div>
					<Button
						variant="secondary"
						onClick={ loadMore }
						isBusy={ loadingMore }
						disabled={ loadingMore }
					>
						{ __( 'Show more assets', 'fair-events-experimental' ) }
					</Button>
				</div>
			) }

			{ deletion.target && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: asset use case */
						__(
							'Delete marketing asset — %s',
							'fair-events-experimental'
						),
						labelOf( deletion.target )
					) }
					confirmLabel={ __(
						'Delete asset',
						'fair-events-experimental'
					) }
					busyLabel={ __( 'Deleting…', 'fair-events-experimental' ) }
					isDestructive
					isBusy={ deletion.isBusy }
					error={ deletion.error }
					onConfirm={ confirmDelete }
					onCancel={ deletion.close }
				>
					<p>
						{ sprintf(
							/* translators: %s: asset use case */
							__(
								'Delete “%s” from this date? Its text and its links to team members and the schedule are deleted. This cannot be undone.',
								'fair-events-experimental'
							),
							labelOf( deletion.target )
						) }
					</p>
					{ deletion.target.image && (
						<p>
							{ __(
								'The image stays in the Media Library, and anyone with its link can still open it.',
								'fair-events-experimental'
							) }
						</p>
					) }
				</ConfirmActionModal>
			) }
		</VStack>
	);
}

function AssetCard( { asset, actionsDisabled, onEdit, onDelete } ) {
	const name = labelOf( asset );
	const hasText = hasMeaningfulText( asset.text );
	const needsRepair = ! hasText && ! asset.image;

	return (
		<Card className="fair-events-marketing-card">
			<CardBody>
				<div className="fair-events-marketing-card-header">
					<h3>{ name }</h3>
					<div className="fair-events-marketing-buttons">
						<Button
							variant="secondary"
							size="small"
							onClick={ onEdit }
							disabled={ actionsDisabled }
							accessibleWhenDisabled
							label={
								needsRepair
									? sprintf(
											/* translators: %s: asset use case */
											__(
												'Repair %s',
												'fair-events-experimental'
											),
											name
										)
									: sprintf(
											/* translators: %s: asset use case */
											__(
												'Edit %s',
												'fair-events-experimental'
											),
											name
										)
							}
						>
							{ needsRepair
								? __( 'Repair', 'fair-events-experimental' )
								: __( 'Edit', 'fair-events-experimental' ) }
						</Button>
						<Button
							variant="tertiary"
							size="small"
							isDestructive
							onClick={ onDelete }
							disabled={ actionsDisabled }
							accessibleWhenDisabled
							label={ sprintf(
								/* translators: %s: asset use case */
								__( 'Delete %s', 'fair-events-experimental' ),
								name
							) }
						>
							{ __( 'Delete', 'fair-events-experimental' ) }
						</Button>
					</div>
				</div>

				{ asset.image_removed && ! asset.image && (
					<Notice status="warning" isDismissible={ false }>
						{ needsRepair
							? __(
									'Image removed: the image was deleted from the Media Library, and this asset has no text. Repair it with text or another image, or delete it.',
									'fair-events-experimental'
								)
							: __(
									'Image removed: the image was deleted from the Media Library.',
									'fair-events-experimental'
								) }
					</Notice>
				) }

				{ asset.image && ! asset.image.available && (
					<Notice status="warning" isDismissible={ false }>
						{ asset.image.unavailable_reason === 'trashed'
							? __(
									'The image is in the Media Library trash. Restore it there or choose another one.',
									'fair-events-experimental'
								)
							: __(
									'The image can no longer be used. Choose another one.',
									'fair-events-experimental'
								) }
					</Notice>
				) }

				<div className="fair-events-marketing-content">
					{ asset.image?.available && asset.image.url && (
						<img
							className="fair-events-marketing-thumb"
							src={ asset.image.url }
							alt={ asset.image.alt || '' }
						/>
					) }
					{ hasText ? (
						<p className="fair-events-marketing-text-preview">
							{ asset.text }
						</p>
					) : (
						<p className="fair-events-marketing-hint">
							{ __( 'No text.', 'fair-events-experimental' ) }
						</p>
					) }
				</div>

				{ ( asset.members.length > 0 || asset.schedule_item ) && (
					<ul className="fair-events-marketing-links">
						{ asset.members.length > 0 && (
							<li>
								{ sprintf(
									/* translators: %s: comma-separated team member names */
									__(
										'Team: %s',
										'fair-events-experimental'
									),
									asset.members
										.map( ( member ) =>
											false === member.public
												? sprintf(
														/* translators: %s: team member name */
														__(
															'%s (name not public)',
															'fair-events-experimental'
														),
														memberName( member )
													)
												: memberName( member )
										)
										.join( ', ' )
								) }
							</li>
						) }
						{ asset.schedule_item && (
							<li>
								{ sprintf(
									/* translators: %s: schedule item title */
									__(
										'Schedule item: %s',
										'fair-events-experimental'
									),
									asset.schedule_item.title ||
										__(
											'(untitled schedule item)',
											'fair-events-experimental'
										)
								) }
							</li>
						) }
					</ul>
				) }
			</CardBody>
		</Card>
	);
}
