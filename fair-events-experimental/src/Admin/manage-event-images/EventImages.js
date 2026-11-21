/**
 * Event Images - Manage Event tab
 *
 * Ordered images for the event and for each saved programme item, each
 * with an optional focal circle. Every list is edited and saved on its own
 * ("Save event images", "Save images for …"); unsaved lists are parked
 * with the host page while another tab is open.
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
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import FocalRegionEditor from './FocalRegionEditor.js';
import {
	addAttachments,
	canMarkFocalRegion,
	entryFromAttachment,
	isDirty,
	listFromResponse,
	listKey,
	moveEntry,
	startingCircle,
	toPayload,
} from './imagesModel.js';

export const TAB_NAME = 'images';

/**
 * Open the Media Library to choose or upload images.
 *
 * @param {Object}   options
 * @param {string}   options.title    Frame title.
 * @param {string}   options.button   Select button label.
 * @param {boolean}  options.multiple Allow several images.
 * @param {Function} options.onSelect Receives the chosen attachments.
 * @return {boolean} False when the Media Library is not available.
 */
export function openMediaFrame( { title, button, multiple, onSelect } ) {
	const media = window.wp?.media;
	if ( typeof media !== 'function' ) {
		return false;
	}
	const frame = media( {
		title,
		button: { text: button },
		library: { type: 'image' },
		multiple,
	} );
	frame.on( 'select', () => {
		onSelect(
			frame
				.state()
				.get( 'selection' )
				.map( ( attachment ) => attachment.toJSON() )
		);
	} );
	frame.open();
	return true;
}

const unavailableText = ( reason ) => {
	if ( reason === 'trashed' ) {
		return __(
			'This image is in the Media Library trash. Unlink it or restore it there.',
			'fair-events-experimental'
		);
	}
	if ( reason === 'not_image' ) {
		return __(
			'This file is no longer a supported image. Unlink it to save this list.',
			'fair-events-experimental'
		);
	}
	return __(
		'This image cannot be shown: its file is missing. Unlink it to save this list.',
		'fair-events-experimental'
	);
};

export default function EventImages( {
	eventDateId,
	setTabDirty,
	getTabDraft,
	setTabDraft,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ meta, setMeta ] = useState( null );
	// List state by key: { revision, entries, saved }.
	const [ lists, setLists ] = useState( {} );
	const [ target, setTarget ] = useState( 'event' );
	const [ savingKey, setSavingKey ] = useState( null );
	const [ notice, setNotice ] = useState( null );

	const applyResponse = useCallback( ( data, keepKeys = [] ) => {
		setMeta( {
			readOnly: !! data.readOnly,
			ownerEditUrl: data.ownerEditUrl,
			scheduleAvailable: !! data.scheduleAvailable,
			scheduleItems: data.scheduleItems || [],
			maxImages: data.maxImagesPerList,
			mimeTypes: data.supportedMimeTypes || [],
		} );
		setLists( ( prev ) => {
			const next = {
				event: listFromResponse( data.event ),
			};
			( data.scheduleItems || [] ).forEach( ( item ) => {
				next[ listKey( item.scheduleItemId ) ] =
					listFromResponse( item );
			} );
			// Lists with unsaved edits keep them across another list's save.
			keepKeys.forEach( ( key ) => {
				if ( prev[ key ] && next[ key ] ) {
					next[ key ] = prev[ key ];
				}
			} );
			return next;
		} );
	}, [] );

	useEffect( () => {
		let cancelled = false;
		apiFetch( {
			path: `/fair-events-experimental/v1/event-dates/${ eventDateId }/images`,
		} )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				applyResponse( data );
				const draft = getTabDraft?.( TAB_NAME );
				if ( draft ) {
					setLists( ( prev ) => {
						const next = { ...prev };
						Object.entries( draft.lists ).forEach(
							( [ key, list ] ) => {
								// A programme item removed meanwhile is gone.
								if ( next[ key ] ) {
									next[ key ] = list;
								}
							}
						);
						return next;
					} );
					if ( draft.target ) {
						setTarget( draft.target );
					}
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The images could not be loaded. Reload the page to try again.',
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
	}, [ eventDateId, applyResponse, getTabDraft ] );

	const dirtyKeys = Object.keys( lists ).filter( ( key ) =>
		isDirty( lists[ key ] )
	);
	const anyDirty = dirtyKeys.length > 0;
	const dirtySignature = dirtyKeys.join( ',' );

	useEffect( () => {
		setTabDirty?.( TAB_NAME, anyDirty );
	}, [ anyDirty, setTabDirty ] );

	useEffect( () => {
		if ( loading ) {
			return;
		}
		if ( ! dirtySignature ) {
			setTabDraft?.( TAB_NAME, undefined );
			return;
		}
		const parked = {};
		dirtySignature.split( ',' ).forEach( ( key ) => {
			parked[ key ] = lists[ key ];
		} );
		setTabDraft?.( TAB_NAME, { lists: parked, target } );
	}, [ loading, dirtySignature, lists, target, setTabDraft ] );

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
			<Notice status="error" isDismissible={ false }>
				{ loadError }
			</Notice>
		);
	}

	const items = meta.scheduleItems;
	const currentItem =
		target === 'event'
			? null
			: items.find(
					( item ) => listKey( item.scheduleItemId ) === target
				);
	const activeKey = currentItem ? target : 'event';
	const list = lists[ activeKey ];
	const readOnly = meta.readOnly;
	const saving = savingKey === activeKey;
	const listName = currentItem
		? currentItem.title ||
			__( '(untitled programme item)', 'fair-events-experimental' )
		: __( 'the event', 'fair-events-experimental' );

	const setEntries = ( updater ) => {
		setNotice( null );
		setLists( ( prev ) => ( {
			...prev,
			[ activeKey ]: {
				...prev[ activeKey ],
				entries: updater( prev[ activeKey ].entries ),
			},
		} ) );
	};

	const updateEntry = ( key, changes ) =>
		setEntries( ( entries ) =>
			entries.map( ( entry ) =>
				entry.key === key ? { ...entry, ...changes } : entry
			)
		);

	const mediaUnavailable = () =>
		setNotice( {
			status: 'error',
			message: __(
				'The Media Library could not be opened. Reload the page and try again.',
				'fair-events-experimental'
			),
		} );

	const handleAdd = () => {
		const opened = openMediaFrame( {
			title: sprintf(
				/* translators: %s: event or programme item name */
				__( 'Add images for %s', 'fair-events-experimental' ),
				listName
			),
			button: __( 'Add images', 'fair-events-experimental' ),
			multiple: true,
			onSelect: ( attachments ) => {
				const result = addAttachments(
					list.entries,
					attachments,
					meta.mimeTypes
				);
				const room = meta.maxImages - list.entries.length;
				const added = result.entries.slice( list.entries.length );
				const kept = added.slice( 0, Math.max( 0, room ) );
				setEntries( ( entries ) => [ ...entries, ...kept ] );

				const problems = [];
				if ( result.unsupported.length ) {
					problems.push(
						sprintf(
							/* translators: %d: number of files */
							_n(
								'%d file was skipped: only JPEG, PNG, GIF, WebP and AVIF images can be used.',
								'%d files were skipped: only JPEG, PNG, GIF, WebP and AVIF images can be used.',
								result.unsupported.length,
								'fair-events-experimental'
							),
							result.unsupported.length
						)
					);
				}
				if ( result.duplicates.length ) {
					problems.push(
						sprintf(
							/* translators: %d: number of images */
							_n(
								'%d image is in this list already.',
								'%d images are in this list already.',
								result.duplicates.length,
								'fair-events-experimental'
							),
							result.duplicates.length
						)
					);
				}
				if ( kept.length < added.length ) {
					problems.push(
						sprintf(
							/* translators: %d: maximum number of images */
							__(
								'A list can hold up to %d images; the rest were not added.',
								'fair-events-experimental'
							),
							meta.maxImages
						)
					);
				}
				if ( problems.length ) {
					setNotice( {
						status: 'warning',
						message: problems.join( ' ' ),
					} );
				}
			},
		} );
		if ( ! opened ) {
			mediaUnavailable();
		}
	};

	const handleReplace = ( entry ) => {
		const opened = openMediaFrame( {
			title: __( 'Replace image', 'fair-events-experimental' ),
			button: __( 'Use this image', 'fair-events-experimental' ),
			multiple: false,
			onSelect: ( [ attachment ] ) => {
				if ( ! attachment ) {
					return;
				}
				if ( ! meta.mimeTypes.includes( attachment.mime ) ) {
					setNotice( {
						status: 'warning',
						message: __(
							'Only JPEG, PNG, GIF, WebP and AVIF images can be used.',
							'fair-events-experimental'
						),
					} );
					return;
				}
				if (
					list.entries.some(
						( other ) =>
							other.key !== entry.key &&
							other.attachmentId === attachment.id
					)
				) {
					setNotice( {
						status: 'warning',
						message: __(
							'That image is in this list already.',
							'fair-events-experimental'
						),
					} );
					return;
				}
				// A replacement is a new link: its circle starts empty.
				setEntries( ( entries ) =>
					entries.map( ( other ) =>
						other.key === entry.key
							? entryFromAttachment( attachment )
							: other
					)
				);
			},
		} );
		if ( ! opened ) {
			mediaUnavailable();
		}
	};

	const handleSave = async () => {
		if ( savingKey ) {
			return;
		}
		setSavingKey( activeKey );
		setNotice( null );
		const path = currentItem
			? `/fair-events-experimental/v1/event-dates/${ eventDateId }/images/schedule-items/${ currentItem.scheduleItemId }`
			: `/fair-events-experimental/v1/event-dates/${ eventDateId }/images/event`;
		try {
			const data = await apiFetch( {
				path,
				method: 'PUT',
				data: toPayload( list ),
			} );
			applyResponse(
				data,
				dirtyKeys.filter( ( key ) => key !== activeKey )
			);
			setNotice( {
				status: 'success',
				message: currentItem
					? sprintf(
							/* translators: %s: programme item name */
							__(
								'Images for %s saved.',
								'fair-events-experimental'
							),
							listName
						)
					: __( 'Event images saved.', 'fair-events-experimental' ),
			} );
		} catch ( err ) {
			// The list stays exactly as edited: nothing was saved.
			setNotice( {
				status: 'error',
				message:
					err?.message ||
					__(
						'The images could not be saved. Your changes are still here — try again.',
						'fair-events-experimental'
					),
				index: err?.data?.index,
			} );
		} finally {
			setSavingKey( null );
		}
	};

	const targetOptions = [
		{
			value: 'event',
			label: isDirty( lists.event )
				? __( 'Event images (unsaved)', 'fair-events-experimental' )
				: __( 'Event images', 'fair-events-experimental' ),
		},
		...items.map( ( item ) => {
			const key = listKey( item.scheduleItemId );
			const title =
				item.title ||
				__( '(untitled programme item)', 'fair-events-experimental' );
			return {
				value: key,
				label: isDirty( lists[ key ] )
					? sprintf(
							/* translators: %s: programme item name */
							__( '%s (unsaved)', 'fair-events-experimental' ),
							title
						)
					: title,
			};
		} ),
	];

	const dirty = isDirty( list );
	const hasUnavailable = list.entries.some( ( entry ) => ! entry.available );
	const saveLabel = currentItem
		? sprintf(
				/* translators: %s: programme item name */
				__( 'Save images for %s', 'fair-events-experimental' ),
				listName
			)
		: __( 'Save event images', 'fair-events-experimental' );

	let saveReason = '';
	if ( hasUnavailable && dirty ) {
		saveReason = __(
			'Unlink the images marked unavailable before saving.',
			'fair-events-experimental'
		);
	}

	return (
		<VStack
			spacing={ 4 }
			className="fair-events-images"
			style={ { marginTop: '16px' } }
		>
			{ readOnly && (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'This date is part of a series. Its images are managed on the series and shown here as they are.',
						'fair-events-experimental'
					) }{ ' ' }
					{ meta.ownerEditUrl && (
						<a href={ meta.ownerEditUrl }>
							{ __(
								'Edit images on the series',
								'fair-events-experimental'
							) }
						</a>
					) }
				</Notice>
			) }

			<Card>
				<CardBody>
					<SelectControl
						label={ __( 'Images for', 'fair-events-experimental' ) }
						value={ activeKey }
						options={ targetOptions }
						onChange={ ( value ) => {
							setTarget( value );
							setNotice( null );
						} }
						help={
							meta.scheduleAvailable
								? __(
										'Choose the event or one of its saved programme items. A new programme item appears here once the schedule is saved.',
										'fair-events-experimental'
									)
								: undefined
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
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

			{ ! readOnly && (
				<div className="fair-events-images-toolbar">
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ saving }
						disabled={ saving || ! dirty || hasUnavailable }
						accessibleWhenDisabled
						aria-describedby={
							saveReason
								? 'fair-events-images-save-reason'
								: undefined
						}
					>
						{ saveLabel }
					</Button>
					<Button
						variant="secondary"
						onClick={ handleAdd }
						disabled={
							saving || list.entries.length >= meta.maxImages
						}
					>
						{ __( 'Add images', 'fair-events-experimental' ) }
					</Button>
					{ ! dirty && (
						<span className="fair-events-images-status">
							{ __(
								'No unsaved changes.',
								'fair-events-experimental'
							) }
						</span>
					) }
					{ saveReason && (
						<span
							id="fair-events-images-save-reason"
							className="fair-events-images-status"
						>
							{ saveReason }
						</span>
					) }
				</div>
			) }

			{ list.entries.length === 0 && (
				<Card>
					<CardBody>
						<p className="fair-events-images-empty">
							{ currentItem
								? __(
										'No images for this programme item yet.',
										'fair-events-experimental'
									)
								: __(
										'No event images yet. Add images from the Media Library or upload new ones; the first one is listed first wherever the images are used.',
										'fair-events-experimental'
									) }
						</p>
					</CardBody>
				</Card>
			) }

			{ list.entries.map( ( entry, index ) => (
				<ImageCard
					key={ entry.key }
					entry={ entry }
					index={ index }
					count={ list.entries.length }
					readOnly={ readOnly || saving }
					hasError={ notice?.index === index }
					onMove={ ( delta ) =>
						setEntries( ( entries ) =>
							moveEntry( entries, index, delta )
						)
					}
					onUnlink={ () =>
						setEntries( ( entries ) =>
							entries.filter(
								( other ) => other.key !== entry.key
							)
						)
					}
					onReplace={ () => handleReplace( entry ) }
					onCircle={ ( focalRegion ) =>
						updateEntry( entry.key, { focalRegion } )
					}
				/>
			) ) }
		</VStack>
	);
}

function ImageCard( {
	entry,
	index,
	count,
	readOnly,
	hasError,
	onMove,
	onUnlink,
	onReplace,
	onCircle,
} ) {
	const name =
		entry.title || __( '(untitled image)', 'fair-events-experimental' );
	const markable = canMarkFocalRegion( entry );

	let status;
	if ( ! entry.available ) {
		status = unavailableText( entry.unavailableReason );
	} else if ( ! entry.id ) {
		status = __(
			'Save this list to mark a focal region on this image.',
			'fair-events-experimental'
		);
	} else if ( ! markable ) {
		status = __(
			'The size of this image is unknown, so no focal region can be marked on it.',
			'fair-events-experimental'
		);
	} else if ( entry.focalRegion ) {
		status = __(
			'Focal region set: the circle marks what must stay visible when the image is cropped.',
			'fair-events-experimental'
		);
	} else {
		status = __( 'No focal region.', 'fair-events-experimental' );
	}

	return (
		<Card
			className={
				hasError
					? 'fair-events-images-card has-error'
					: 'fair-events-images-card'
			}
		>
			<CardBody>
				<HStack alignment="top" justify="space-between" wrap>
					<div className="fair-events-images-heading">
						<h3>
							{ sprintf(
								/* translators: 1: position in the list, 2: image title */
								__( '%1$d. %2$s', 'fair-events-experimental' ),
								index + 1,
								name
							) }
						</h3>
						{ entry.width && entry.height && (
							<span className="fair-events-images-badge">
								{ sprintf(
									/* translators: 1: width in pixels, 2: height in pixels */
									__(
										'%1$d × %2$d px',
										'fair-events-experimental'
									),
									entry.width,
									entry.height
								) }
							</span>
						) }
					</div>
					{ ! readOnly && (
						<div className="fair-events-images-actions">
							<Button
								variant="tertiary"
								size="small"
								onClick={ () => onMove( -1 ) }
								disabled={ index === 0 }
								accessibleWhenDisabled
								label={ sprintf(
									/* translators: %s: image title */
									__(
										'Move %s up',
										'fair-events-experimental'
									),
									name
								) }
							>
								{ __( 'Move up', 'fair-events-experimental' ) }
							</Button>
							<Button
								variant="tertiary"
								size="small"
								onClick={ () => onMove( 1 ) }
								disabled={ index === count - 1 }
								accessibleWhenDisabled
								label={ sprintf(
									/* translators: %s: image title */
									__(
										'Move %s down',
										'fair-events-experimental'
									),
									name
								) }
							>
								{ __(
									'Move down',
									'fair-events-experimental'
								) }
							</Button>
							<Button
								variant="tertiary"
								size="small"
								onClick={ onReplace }
								label={ sprintf(
									/* translators: %s: image title */
									__(
										'Replace %s',
										'fair-events-experimental'
									),
									name
								) }
							>
								{ __( 'Replace', 'fair-events-experimental' ) }
							</Button>
							<Button
								variant="tertiary"
								size="small"
								isDestructive
								onClick={ onUnlink }
								label={ sprintf(
									/* translators: %s: image title */
									__(
										'Unlink %s (it stays in the Media Library)',
										'fair-events-experimental'
									),
									name
								) }
							>
								{ __( 'Unlink', 'fair-events-experimental' ) }
							</Button>
						</div>
					) }
				</HStack>

				{ entry.focalRegionNeedsReview && ! entry.focalRegion && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'This image was edited in the Media Library after its focal region was marked, so the old circle is no longer used. Mark it again if needed.',
							'fair-events-experimental'
						) }
					</Notice>
				) }

				<p className="fair-events-images-hint">{ status }</p>

				{ entry.available && entry.sourceUrl && (
					<FocalRegionEditor
						sourceUrl={ entry.sourceUrl }
						alt={ entry.altText }
						width={ entry.width }
						height={ entry.height }
						circle={ markable ? entry.focalRegion : null }
						onChange={ onCircle }
						disabled={ readOnly }
						idPrefix={ `fair-events-images-${ entry.key }` }
					/>
				) }

				{ markable && ! readOnly && (
					<div className="fair-events-images-circle-actions">
						{ entry.focalRegion ? (
							<Button
								variant="secondary"
								size="small"
								isDestructive
								onClick={ () => onCircle( null ) }
							>
								{ __(
									'Remove focal region',
									'fair-events-experimental'
								) }
							</Button>
						) : (
							<Button
								variant="secondary"
								size="small"
								onClick={ () => onCircle( startingCircle() ) }
							>
								{ __(
									'Mark focal region',
									'fair-events-experimental'
								) }
							</Button>
						) }
					</div>
				) }
			</CardBody>
		</Card>
	);
}
