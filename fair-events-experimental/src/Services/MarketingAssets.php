<?php
/**
 * Marketing assets of event occurrences.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Services;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Core\Plugin;
use FairEventsExperimental\Models\MarketingAssetRepository;
use FairEventsExperimental\Models\TeamMemberRepository;
use WP_Error;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Validates, stores and reads the marketing assets of one event
 * occurrence (#2396), and keeps them in step with the team, the schedule,
 * the Media Library and the event lifecycle.
 *
 * An asset belongs to the exact event date it was created on: a generated
 * occurrence has its own list, and a series' assets never appear on its
 * other dates. Team members come from the occurrence's team (the series'
 * team for a generated occurrence) and schedule items from its schedule
 * (the series' schedule likewise).
 *
 * Writes run in one transaction. The member and schedule rows an asset
 * links to are locked while it is written, so an unlink or a schedule save
 * either lands first (and the link is refused or dropped) or waits and
 * then removes the new link through the lifecycle hooks below.
 *
 * Images are ordinary WordPress attachments. Unlinking an image or
 * deleting an asset never deletes the attachment, and nothing here changes
 * who can open its file. See docs/marketing-assets.md.
 */
class MarketingAssets {

	/**
	 * Accepted image types.
	 */
	public const MIME_TYPES = array( 'image/jpeg', 'image/png' );

	/**
	 * Longest label, in characters.
	 */
	public const MAX_LABEL_LENGTH = 191;

	/**
	 * Longest text, in characters.
	 */
	public const MAX_TEXT_LENGTH = 10000;

	/**
	 * Most team members one asset links to.
	 */
	public const MAX_MEMBERS = 50;

	/**
	 * Storage.
	 *
	 * @var MarketingAssetRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 *
	 * @param MarketingAssetRepository|null $repository Storage.
	 */
	public function __construct( $repository = null ) {
		$this->repository = $repository ? $repository : new MarketingAssetRepository();
	}

	/**
	 * Register the lifecycle hooks. They run whether or not the bundle is
	 * on, and do nothing until the tables exist.
	 *
	 * @return void
	 */
	public static function register_lifecycle_hooks() {
		$service = new self();
		add_action( 'fair_events_event_date_deleted', array( $service, 'handle_event_date_deleted' ), 10, 1 );
		add_action( 'delete_attachment', array( $service, 'handle_attachment_deleted' ), 10, 1 );
		add_action( 'fair_events_experimental_team_member_unlinked', array( $service, 'handle_team_member_unlinked' ), 10, 2 );
		add_action( 'fair_events_schedule_item_deleted', array( $service, 'handle_schedule_item_deleted' ), 10, 1 );
	}

	/**
	 * Remove the assets of a permanently deleted event date.
	 *
	 * @param int $event_date_id Deleted event date ID.
	 * @return void
	 */
	public function handle_event_date_deleted( $event_date_id ) {
		if ( MarketingAssetRepository::is_installed() ) {
			$this->repository->delete_for_event_date( (int) $event_date_id );
		}
	}

	/**
	 * Clear a deleted attachment from the assets using it. Label, text and
	 * associations stay; the asset is marked "image removed".
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return void
	 */
	public function handle_attachment_deleted( $attachment_id ) {
		if ( MarketingAssetRepository::is_installed() ) {
			$this->repository->clear_attachment( (int) $attachment_id );
		}
	}

	/**
	 * Drop a member's links from the assets of every date that shares the
	 * team they were removed from: the owner and its generated occurrences.
	 *
	 * @param int $owner_id  Team owner event date ID.
	 * @param int $member_id Removed member ID.
	 * @return void
	 */
	public function handle_team_member_unlinked( $owner_id, $member_id ) {
		global $wpdb;

		if ( ! MarketingAssetRepository::is_installed() ) {
			return;
		}

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM %i WHERE id = %d OR ( master_id = %d AND occurrence_type = 'generated' )",
				$wpdb->prefix . 'fair_event_dates',
				(int) $owner_id,
				(int) $owner_id
			)
		);

		$this->repository->remove_member_from_event_dates( (int) $member_id, array_merge( array( (int) $owner_id ), array_map( 'intval', (array) $ids ) ) );
	}

	/**
	 * Clear a removed schedule item from the assets naming it. Runs inside
	 * the schedule save's transaction.
	 *
	 * @param int $schedule_item_id Removed schedule item ID.
	 * @return void
	 */
	public function handle_schedule_item_deleted( $schedule_item_id ) {
		if ( MarketingAssetRepository::is_installed() ) {
			$this->repository->clear_schedule_item( (int) $schedule_item_id );
		}
	}

	/**
	 * Whether team members can be added to this date's assets now.
	 *
	 * @return bool
	 */
	public static function team_available() {
		return Plugin::team_members_available() && TeamMemberRepository::is_installed();
	}

	/**
	 * Whether schedule items can be linked on this date's assets now: the
	 * active Fair Events stores schedules and the organizer enabled one.
	 *
	 * @param EventDates $event_date Event date.
	 * @return bool
	 */
	public static function schedule_available( EventDates $event_date ) {
		return class_exists( \FairEvents\Services\EventSchedule::class )
			&& \FairEvents\Services\EventSchedule::is_enabled( self::schedule_owner_id( $event_date ) );
	}

	/**
	 * The event date a date's schedule is stored on.
	 *
	 * @param EventDates $event_date Event date.
	 * @return int
	 */
	private static function schedule_owner_id( EventDates $event_date ) {
		if ( class_exists( \FairEvents\Services\EventSchedule::class ) ) {
			return \FairEvents\Services\EventSchedule::config_event_date_id( $event_date );
		}
		return TeamMembership::owner_id( $event_date );
	}

	/**
	 * Team members of the date's team: `{ id, name, surname }`, keyed by ID.
	 *
	 * @param EventDates $event_date Event date.
	 * @return array<int, array>
	 */
	private static function team( EventDates $event_date ) {
		if ( ! TeamMemberRepository::is_installed() ) {
			return array();
		}
		$out = array();
		foreach ( ( new TeamMembership() )->members( $event_date ) as $member ) {
			$out[ (int) $member['id'] ] = $member;
		}
		return $out;
	}

	/**
	 * Schedule items of the date's schedule, with dates shifted to the
	 * occurrence: `{ id, title, start_datetime, end_datetime }`, keyed by ID.
	 *
	 * @param EventDates $event_date Event date.
	 * @return array<int, array>
	 */
	private static function schedule( EventDates $event_date ) {
		if ( ! class_exists( \FairEvents\Services\EventSchedule::class ) ) {
			return array();
		}
		$out = array();
		foreach ( (array) ( \FairEvents\Services\EventSchedule::get_payload( $event_date )['items'] ?? array() ) as $item ) {
			$out[ (int) $item['id'] ] = array(
				'id'             => (int) $item['id'],
				'title'          => (string) $item['title'],
				'start_datetime' => (string) $item['start_datetime'],
				'end_datetime'   => (string) $item['end_datetime'],
			);
		}
		return $out;
	}

	/**
	 * What the editor may offer for a date: the team and schedule it can
	 * link, whether each can be added to now, and the limits.
	 *
	 * @param EventDates $event_date Event date.
	 * @return array
	 */
	public function options( EventDates $event_date ) {
		$team_available     = self::team_available();
		$schedule_available = self::schedule_available( $event_date );

		return array(
			'event_date_id'        => (int) $event_date->id,
			'team'                 => array(
				'available' => $team_available,
				'members'   => $team_available ? array_values( self::team( $event_date ) ) : array(),
			),
			'schedule'             => array(
				'available' => $schedule_available,
				'items'     => $schedule_available ? array_values( self::schedule( $event_date ) ) : array(),
			),
			'supported_mime_types' => self::MIME_TYPES,
			'max_label_length'     => self::MAX_LABEL_LENGTH,
			'max_text_length'      => self::MAX_TEXT_LENGTH,
			'max_members'          => self::MAX_MEMBERS,
		);
	}

	/**
	 * One page of a date's assets.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int        $page       Page, from 1.
	 * @param int        $per_page   Page size.
	 * @return array{items: array[], total: int, page: int, per_page: int, total_pages: int}
	 */
	public function list_assets( EventDates $event_date, $page, $per_page ) {
		$total = $this->repository->count_for_event_date( (int) $event_date->id );
		$rows  = $this->repository->page_for_event_date( (int) $event_date->id, $per_page, ( $page - 1 ) * $per_page );

		return array(
			'items'       => $this->shape_all( $event_date, $rows ),
			'total'       => $total,
			'page'        => (int) $page,
			'per_page'    => (int) $per_page,
			'total_pages' => (int) max( 1, (int) ceil( $total / $per_page ) ),
		);
	}

	/**
	 * One asset of a date.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int        $asset_id   Asset ID.
	 * @return array|WP_Error
	 */
	public function get_asset( EventDates $event_date, $asset_id ) {
		$row = $this->repository->find( (int) $asset_id );
		if ( ! $row || (int) $row['event_date_id'] !== (int) $event_date->id ) {
			return self::asset_not_found();
		}
		return $this->shape( $event_date, $row );
	}

	/**
	 * Create an asset.
	 *
	 * @param EventDates $event_date Event date.
	 * @param array      $params     Submitted fields; see write().
	 * @return array|WP_Error The new asset.
	 */
	public function create_asset( EventDates $event_date, array $params ) {
		return $this->write( $event_date, null, $params );
	}

	/**
	 * Update an asset. Omitted fields keep their value.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int        $asset_id   Asset ID.
	 * @param array      $params     Submitted fields; see write().
	 * @return array|WP_Error The updated asset.
	 */
	public function update_asset( EventDates $event_date, $asset_id, array $params ) {
		return $this->write( $event_date, (int) $asset_id, $params );
	}

	/**
	 * Delete an asset and its links. The attachment stays in the Media
	 * Library.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int        $asset_id   Asset ID.
	 * @return array|WP_Error The deleted asset as it was.
	 */
	public function delete_asset( EventDates $event_date, $asset_id ) {
		global $wpdb;

		$wpdb->query( 'START TRANSACTION' );
		$row = $this->repository->find( (int) $asset_id, true );
		if ( ! $row || (int) $row['event_date_id'] !== (int) $event_date->id ) {
			$wpdb->query( 'ROLLBACK' );
			return self::asset_not_found();
		}

		$previous = $this->shape( $event_date, $row );
		if ( ! $this->repository->delete( (int) $asset_id ) ) {
			$wpdb->query( 'ROLLBACK' );
			return new WP_Error(
				'marketing_asset_delete_failed',
				__( 'The asset could not be deleted. Nothing was changed — try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}
		$wpdb->query( 'COMMIT' );

		return $previous;
	}

	/**
	 * Validate and store an asset.
	 *
	 * `$params` holds only the submitted fields: `label` (string), `text`
	 * (string), `attachment_id` (int|null), `member_ids` (int[]|null) and
	 * `schedule_item_id` (int|null). A null or empty value clears an
	 * optional field.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int|null   $asset_id   Asset to update, null to create.
	 * @param array      $params     Submitted fields.
	 * @return array|WP_Error
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	private function write( EventDates $event_date, $asset_id, array $params ) {
		global $wpdb;

		$errors = $this->validate_fields( $params, null === $asset_id );
		if ( $errors ) {
			return self::invalid( $errors );
		}

		$wpdb->query( 'START TRANSACTION' );
		try {
			$result = $this->write_locked( $event_date, $asset_id, $params );
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( is_wp_error( $result ) ) {
			$wpdb->query( 'ROLLBACK' );
			return $result;
		}
		$wpdb->query( 'COMMIT' );

		$row = $this->repository->find( $result );
		return $row ? $this->shape( $event_date, $row ) : self::save_failed();
	}

	/**
	 * The transactional part of write().
	 *
	 * @param EventDates $event_date Event date.
	 * @param int|null   $asset_id   Asset to update, null to create.
	 * @param array      $params     Validated fields.
	 * @return int|WP_Error Asset ID.
	 */
	private function write_locked( EventDates $event_date, $asset_id, array $params ) {
		$stored = null;
		if ( null !== $asset_id ) {
			$stored = $this->repository->find( $asset_id, true );
			if ( ! $stored || (int) $stored['event_date_id'] !== (int) $event_date->id ) {
				return self::asset_not_found();
			}
		}

		$final = array(
			'label'            => array_key_exists( 'label', $params ) ? (string) $params['label'] : ( $stored['label'] ?? '' ),
			'text'             => array_key_exists( 'text', $params ) ? (string) $params['text'] : ( $stored['text'] ?? '' ),
			'attachment_id'    => array_key_exists( 'attachment_id', $params ) ? self::positive_or_null( $params['attachment_id'] ) : ( $stored['attachment_id'] ?? null ),
			'schedule_item_id' => array_key_exists( 'schedule_item_id', $params ) ? self::positive_or_null( $params['schedule_item_id'] ) : ( $stored['schedule_item_id'] ?? null ),
			'member_ids'       => array_key_exists( 'member_ids', $params ) ? self::id_list( $params['member_ids'] ) : ( $stored['member_ids'] ?? array() ),
		);

		$errors = array();

		// Image: a new attachment must be a readable PNG or JPEG.
		$image_ok = false;
		if ( $final['attachment_id'] ) {
			$image    = self::describe_attachment( $final['attachment_id'] );
			$image_ok = $image['available'];
			$changed  = ! $stored || $stored['attachment_id'] !== $final['attachment_id'];
			if ( $changed && ! $image_ok ) {
				$errors['attachment_id'] = self::attachment_error( $image['unavailable_reason'] );
			} elseif ( $changed && ! current_user_can( 'read_post', $final['attachment_id'] ) ) {
				$errors['attachment_id'] = array(
					'code'    => 'marketing_asset_attachment_forbidden',
					'message' => __( 'You cannot use this image. Choose another one from the Media Library.', 'fair-events-experimental' ),
				);
			}
		}

		if ( ! isset( $errors['attachment_id'] ) && ! self::has_meaningful_text( $final['text'] ) && ! $image_ok ) {
			$errors['content'] = array(
				'code'    => 'marketing_asset_content_required',
				'message' => __( 'Add text, an image, or both.', 'fair-events-experimental' ),
			);
		}

		// Team members: new links need the team feature and a member on
		// this date's team; links already stored may only be removed while
		// it is off. Locked rows keep a concurrent unlink in order.
		$stored_members = $stored ? $stored['member_ids'] : array();
		$added          = array_values( array_diff( $final['member_ids'], $stored_members ) );
		if ( $added && ! self::team_available() ) {
			return new WP_Error(
				'marketing_asset_team_unavailable',
				__( 'Team members cannot be added while team management is turned off. You can still remove the ones already linked.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}
		$on_team     = $this->lock_team_members( $event_date, $final['member_ids'] );
		$not_on_team = array_values( array_diff( $added, $on_team ) );
		if ( $not_on_team ) {
			$errors['member_ids'] = array(
				'code'    => 'marketing_asset_member_not_on_team',
				'message' => __( 'Only members of this event\'s team can be linked. Reload the page to see the current team.', 'fair-events-experimental' ),
				'ids'     => $not_on_team,
			);
		} else {
			// A member removed from the team meanwhile is dropped, not resurrected.
			$final['member_ids'] = array_values( array_intersect( $final['member_ids'], $on_team ) );
		}

		// Schedule item: same rule as members.
		$stored_item = $stored ? $stored['schedule_item_id'] : null;
		if ( $final['schedule_item_id'] ) {
			$exists = $this->lock_schedule_item( $event_date, $final['schedule_item_id'] );
			if ( $final['schedule_item_id'] !== $stored_item ) {
				if ( ! self::schedule_available( $event_date ) ) {
					return new WP_Error(
						'marketing_asset_schedule_unavailable',
						__( 'A schedule item cannot be linked while this event\'s schedule is turned off. You can still remove the one already linked.', 'fair-events-experimental' ),
						array( 'status' => 409 )
					);
				}
				if ( ! $exists ) {
					$errors['schedule_item_id'] = array(
						'code'    => 'marketing_asset_schedule_item_not_found',
						'message' => __( 'This schedule item is not on this event\'s schedule. Reload the page to see the current schedule.', 'fair-events-experimental' ),
					);
				}
			} elseif ( ! $exists ) {
				$final['schedule_item_id'] = null;
			}
		}

		if ( $errors ) {
			return self::invalid( $errors );
		}

		if ( $stored ) {
			$ok = $this->repository->update( $stored['id'], $final );
			$id = $stored['id'];
		} else {
			$id = $this->repository->insert( array_merge( $final, array( 'event_date_id' => (int) $event_date->id ) ) );
			$ok = $id > 0;
		}

		if ( ! $ok || ! $this->repository->replace_members( $id, $final['member_ids'] ) ) {
			return self::save_failed();
		}

		return $id;
	}

	/**
	 * Check the submitted fields' shape before anything is locked.
	 *
	 * @param array $params  Submitted fields.
	 * @param bool  $creating Whether this is a create.
	 * @return array<string, array{code: string, message: string}>
	 */
	private function validate_fields( array $params, $creating ) {
		$errors = array();

		if ( $creating || array_key_exists( 'label', $params ) ) {
			$label    = isset( $params['label'] ) ? $params['label'] : '';
			$readable = is_string( $label ) && self::is_valid_utf8( $label );
			if ( $readable && ! self::has_meaningful_text( $label ) ) {
				$errors['label'] = array(
					'code'    => 'marketing_asset_label_required',
					'message' => __( 'Enter what the asset is for, such as "Instagram post".', 'fair-events-experimental' ),
				);
			} elseif ( ! $readable || preg_match( '/[\p{Cc}]/u', $label ) ) {
				$errors['label'] = array(
					'code'    => 'marketing_asset_label_invalid',
					'message' => __( 'The use case must be a single line of plain text.', 'fair-events-experimental' ),
				);
			} elseif ( mb_strlen( $label ) > self::MAX_LABEL_LENGTH ) {
				$errors['label'] = array(
					'code'    => 'marketing_asset_label_too_long',
					'message' => sprintf(
						/* translators: %d: maximum number of characters */
						__( 'The use case can be up to %d characters long.', 'fair-events-experimental' ),
						self::MAX_LABEL_LENGTH
					),
				);
			}
		}

		if ( array_key_exists( 'text', $params ) && null !== $params['text'] ) {
			$text = $params['text'];
			if ( ! is_string( $text ) || ! self::is_valid_utf8( $text ) ) {
				$errors['text'] = array(
					'code'    => 'marketing_asset_text_invalid',
					'message' => __( 'The text could not be read. Paste it again as plain text.', 'fair-events-experimental' ),
				);
			} elseif ( mb_strlen( $text ) > self::MAX_TEXT_LENGTH ) {
				$errors['text'] = array(
					'code'    => 'marketing_asset_text_too_long',
					'message' => sprintf(
						/* translators: %d: maximum number of characters */
						__( 'The text can be up to %d characters long.', 'fair-events-experimental' ),
						self::MAX_TEXT_LENGTH
					),
				);
			}
		}

		if ( array_key_exists( 'member_ids', $params ) && count( self::id_list( $params['member_ids'] ) ) > self::MAX_MEMBERS ) {
			$errors['member_ids'] = array(
				'code'    => 'marketing_asset_too_many_members',
				'message' => sprintf(
					/* translators: %d: maximum number of team members */
					__( 'An asset can link up to %d team members.', 'fair-events-experimental' ),
					self::MAX_MEMBERS
				),
			);
		}

		return $errors;
	}

	/**
	 * Lock the team rows of the given members on the date's team and
	 * return the ones that are on it.
	 *
	 * @param EventDates $event_date Event date.
	 * @param int[]      $member_ids Member IDs.
	 * @return int[]
	 */
	private function lock_team_members( EventDates $event_date, array $member_ids ) {
		global $wpdb;

		if ( ! $member_ids || ! TeamMemberRepository::is_installed() ) {
			return array();
		}

		$placeholders = implode( ', ', array_fill( 0, count( $member_ids ), '%d' ) );
		$ids          = $wpdb->get_col(
			$wpdb->prepare( // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- One array of every value.
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- Placeholders only.
				"SELECT member_id FROM %i WHERE owner_event_date_id = %d AND member_id IN ( $placeholders ) FOR UPDATE",
				array_merge(
					array( TeamMemberRepository::memberships_table(), TeamMembership::owner_id( $event_date ) ),
					$member_ids
				)
			)
		);

		return array_map( 'intval', (array) $ids );
	}

	/**
	 * Lock a schedule item of the date's schedule; false when it is not on it.
	 *
	 * @param EventDates $event_date       Event date.
	 * @param int        $schedule_item_id Schedule item ID.
	 * @return bool
	 */
	private function lock_schedule_item( EventDates $event_date, $schedule_item_id ) {
		global $wpdb;

		if ( ! class_exists( \FairEvents\Models\ScheduleItem::class ) ) {
			return false;
		}

		return null !== $wpdb->get_var(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE id = %d AND event_date_id = %d FOR UPDATE',
				\FairEvents\Models\ScheduleItem::get_table_name(),
				(int) $schedule_item_id,
				self::schedule_owner_id( $event_date )
			)
		);
	}

	/**
	 * Describe an attachment for the editor and consumers.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return array{attachment_id: int, available: bool, unavailable_reason: string|null, url: string|null, mime_type: string|null, width: int|null, height: int|null, alt: string|null, title: string}
	 */
	public static function describe_attachment( $attachment_id ) {
		$out = array(
			'attachment_id'      => (int) $attachment_id,
			'available'          => false,
			'unavailable_reason' => 'missing',
			'url'                => null,
			'mime_type'          => null,
			'width'              => null,
			'height'             => null,
			'alt'                => null,
			'title'              => '',
		);

		$post = get_post( (int) $attachment_id );
		if ( ! $post || 'attachment' !== $post->post_type ) {
			return $out;
		}

		$out['mime_type'] = (string) $post->post_mime_type;
		$out['title']     = get_the_title( $post );

		if ( 'trash' === $post->post_status ) {
			$out['unavailable_reason'] = 'trashed';
			return $out;
		}

		if ( ! in_array( $out['mime_type'], self::MIME_TYPES, true ) ) {
			$out['unavailable_reason'] = 'unsupported_type';
			return $out;
		}

		$url  = wp_get_attachment_url( $post->ID );
		$file = get_attached_file( $post->ID );
		if ( ! $url || ! $file || ! file_exists( $file ) ) {
			$out['unavailable_reason'] = 'missing_file';
			return $out;
		}

		$meta = wp_get_attachment_metadata( $post->ID );
		$alt  = trim( (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ) );

		return array_merge(
			$out,
			array(
				'available'          => true,
				'unavailable_reason' => null,
				'url'                => $url,
				'width'              => isset( $meta['width'] ) ? (int) $meta['width'] : null,
				'height'             => isset( $meta['height'] ) ? (int) $meta['height'] : null,
				'alt'                => '' === $alt ? null : $alt,
			)
		);
	}

	/**
	 * Shape stored rows for a response, reading the team and schedule once.
	 *
	 * @param EventDates $event_date Event date.
	 * @param array[]    $rows       Hydrated rows.
	 * @return array[]
	 */
	private function shape_all( EventDates $event_date, array $rows ) {
		if ( ! $rows ) {
			return array();
		}
		$team     = self::team( $event_date );
		$schedule = self::schedule( $event_date );
		return array_map(
			function ( $row ) use ( $event_date, $team, $schedule ) {
				return $this->shape( $event_date, $row, $team, $schedule );
			},
			$rows
		);
	}

	/**
	 * Shape one stored row. Links to members no longer on the team, or to
	 * items no longer on the schedule, are left out; a deleted attachment
	 * reads as an image removed.
	 *
	 * @param EventDates $event_date Event date.
	 * @param array      $row        Hydrated row.
	 * @param array|null $team       Team, keyed by member ID.
	 * @param array|null $schedule   Schedule, keyed by item ID.
	 * @return array
	 */
	private function shape( EventDates $event_date, array $row, $team = null, $schedule = null ) {
		$team     = null === $team ? self::team( $event_date ) : $team;
		$schedule = null === $schedule ? self::schedule( $event_date ) : $schedule;

		$members = array();
		foreach ( $row['member_ids'] as $member_id ) {
			if ( isset( $team[ $member_id ] ) ) {
				$members[] = $team[ $member_id ];
			}
		}

		$image         = $row['attachment_id'] ? self::describe_attachment( $row['attachment_id'] ) : null;
		$image_removed = $row['image_removed'];
		if ( $image && 'missing' === $image['unavailable_reason'] ) {
			$image         = null;
			$image_removed = true;
		}

		$item = $row['schedule_item_id'] && isset( $schedule[ $row['schedule_item_id'] ] ) ? $schedule[ $row['schedule_item_id'] ] : null;

		return array(
			'id'               => $row['id'],
			'event_date_id'    => $row['event_date_id'],
			'label'            => $row['label'],
			'text'             => $row['text'],
			'attachment_id'    => $image ? $image['attachment_id'] : null,
			'image'            => $image,
			'image_removed'    => $image_removed,
			'member_ids'       => array_map( 'intval', wp_list_pluck( $members, 'id' ) ),
			'members'          => $members,
			'schedule_item_id' => $item ? $item['id'] : null,
			'schedule_item'    => $item,
			'created_at'       => self::utc( $row['created_at'] ),
			'updated_at'       => self::utc( $row['updated_at'] ),
		);
	}

	/**
	 * Whether text has at least one character that is not whitespace, a
	 * separator, a control or a formatting character. The text itself is
	 * never changed.
	 *
	 * @param string $text Text.
	 * @return bool
	 */
	public static function has_meaningful_text( $text ) {
		return is_string( $text ) && 1 === preg_match( '/[^\s\p{Z}\p{Cc}\p{Cf}]/u', $text );
	}

	/**
	 * Whether a string is valid UTF-8.
	 *
	 * @param string $value Value.
	 * @return bool
	 */
	private static function is_valid_utf8( $value ) {
		return 1 === preg_match( '//u', $value );
	}

	/**
	 * A positive integer, or null for an empty value.
	 *
	 * @param mixed $value Value.
	 * @return int|null
	 */
	private static function positive_or_null( $value ) {
		$value = (int) $value;
		return $value > 0 ? $value : null;
	}

	/**
	 * Unique positive integers, in the given order; null is an empty list.
	 *
	 * @param mixed $value Value.
	 * @return int[]
	 */
	private static function id_list( $value ) {
		return array_values( array_unique( array_filter( array_map( 'intval', (array) $value ) ) ) );
	}

	/**
	 * A stored UTC datetime in ISO 8601.
	 *
	 * @param string $value MySQL datetime, UTC.
	 * @return string
	 */
	private static function utc( $value ) {
		return gmdate( 'Y-m-d\TH:i:s\Z', (int) strtotime( $value . ' UTC' ) );
	}

	/**
	 * Field error for an unusable attachment.
	 *
	 * @param string|null $reason Unavailable reason.
	 * @return array{code: string, message: string}
	 */
	private static function attachment_error( $reason ) {
		if ( 'unsupported_type' === $reason ) {
			return array(
				'code'    => 'marketing_asset_attachment_type',
				'message' => __( 'Only PNG and JPEG images can be used.', 'fair-events-experimental' ),
			);
		}
		return array(
			'code'    => 'marketing_asset_attachment_not_found',
			'message' => __( 'This image is not available in the Media Library. Choose or upload another one.', 'fair-events-experimental' ),
		);
	}

	/**
	 * Validation error with one entry per field.
	 *
	 * @param array<string, array> $errors Field errors.
	 * @return WP_Error
	 */
	private static function invalid( array $errors ) {
		return new WP_Error(
			'rest_invalid_param',
			sprintf(
				/* translators: %s: comma-separated list of field names */
				__( 'Invalid parameter(s): %s', 'fair-events-experimental' ),
				implode( ', ', array_keys( $errors ) )
			),
			array(
				'status'  => 400,
				'params'  => wp_list_pluck( $errors, 'message' ),
				'details' => $errors,
			)
		);
	}

	/**
	 * Error for an asset that is not on this date.
	 *
	 * @return WP_Error
	 */
	private static function asset_not_found() {
		return new WP_Error(
			'marketing_asset_not_found',
			__( 'This marketing asset does not exist on this date. Reload the page to see the current list.', 'fair-events-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Error for a failed write.
	 *
	 * @return WP_Error
	 */
	private static function save_failed() {
		return new WP_Error(
			'marketing_asset_save_failed',
			__( 'The asset could not be saved. Nothing was changed — try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}
}
