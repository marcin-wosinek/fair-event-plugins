<?php
/**
 * Scheduled Message Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Scheduled per-event mailing model.
 */
class ScheduledMessage {

	/**
	 * Message ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event post ID (denormalized for indexing / reschedule lookups).
	 *
	 * @var int
	 */
	public $event_id;

	/**
	 * Event date ID — anchor for event_date_* anchor types.
	 *
	 * @var int|null
	 */
	public $event_date_id;

	/**
	 * Email subject.
	 *
	 * @var string
	 */
	public $subject;

	/**
	 * Email body (HTML, supports placeholders).
	 *
	 * @var string
	 */
	public $body;

	/**
	 * Anchor type.
	 *
	 * One of event_date_start, event_date_end, sale_period_start,
	 * sale_period_end.
	 *
	 * @var string
	 */
	public $anchor_type;

	/**
	 * Id of the anchor row (event_date id, or sale period id once #617 lands).
	 *
	 * @var int|null
	 */
	public $anchor_ref_id;

	/**
	 * Signed offset in minutes; negative = before anchor, positive = after.
	 *
	 * @var int
	 */
	public $offset_minutes;

	/**
	 * Recipient filter: {labels, group_ids, is_marketing}.
	 *
	 * @var array
	 */
	public $recipients_filter;

	/**
	 * Computed send time (anchor_time + offset_minutes), local time.
	 *
	 * @var string|null
	 */
	public $scheduled_for;

	/**
	 * Status: scheduled, sending, sent, canceled, failed.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Number of emails sent successfully.
	 *
	 * @var int
	 */
	public $sent_count;

	/**
	 * Number of emails that failed to send.
	 *
	 * @var int
	 */
	public $failed_count;

	/**
	 * Number of recipients skipped.
	 *
	 * @var int
	 */
	public $skipped_count;

	/**
	 * Sent timestamp.
	 *
	 * @var string|null
	 */
	public $sent_at;

	/**
	 * Last error message (set when status=failed).
	 *
	 * @var string|null
	 */
	public $last_error;

	/**
	 * Creator user ID.
	 *
	 * @var int|null
	 */
	public $created_by;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional data to populate.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate from data array (DB row or input).
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->event_id       = isset( $data['event_id'] ) ? (int) $data['event_id'] : 0;
		$this->event_date_id  = isset( $data['event_date_id'] ) && $data['event_date_id'] ? (int) $data['event_date_id'] : null;
		$this->subject        = isset( $data['subject'] ) ? sanitize_text_field( $data['subject'] ) : '';
		$this->body           = isset( $data['body'] ) ? wp_kses_post( $data['body'] ) : '';
		$this->anchor_type    = isset( $data['anchor_type'] ) ? sanitize_key( $data['anchor_type'] ) : '';
		$this->anchor_ref_id  = isset( $data['anchor_ref_id'] ) && $data['anchor_ref_id'] ? (int) $data['anchor_ref_id'] : null;
		$this->offset_minutes = isset( $data['offset_minutes'] ) ? (int) $data['offset_minutes'] : 0;

		if ( isset( $data['recipients_filter'] ) ) {
			$this->recipients_filter = is_array( $data['recipients_filter'] )
				? $data['recipients_filter']
				: (array) json_decode( (string) $data['recipients_filter'], true );
		} else {
			$this->recipients_filter = array();
		}

		$this->scheduled_for = isset( $data['scheduled_for'] ) && $data['scheduled_for'] ? $data['scheduled_for'] : null;
		$this->status        = isset( $data['status'] ) ? sanitize_key( $data['status'] ) : 'scheduled';
		$this->sent_count    = isset( $data['sent_count'] ) ? (int) $data['sent_count'] : 0;
		$this->failed_count  = isset( $data['failed_count'] ) ? (int) $data['failed_count'] : 0;
		$this->skipped_count = isset( $data['skipped_count'] ) ? (int) $data['skipped_count'] : 0;
		$this->sent_at       = isset( $data['sent_at'] ) && $data['sent_at'] ? $data['sent_at'] : null;
		$this->last_error    = isset( $data['last_error'] ) && $data['last_error'] ? $data['last_error'] : null;
		$this->created_by    = isset( $data['created_by'] ) && $data['created_by'] ? (int) $data['created_by'] : null;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at    = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database (insert or update).
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_event_scheduled_messages';

		if ( empty( $this->subject ) || empty( $this->body ) || empty( $this->anchor_type ) ) {
			return false;
		}

		$data = array(
			'event_id'          => $this->event_id,
			'event_date_id'     => $this->event_date_id,
			'subject'           => $this->subject,
			'body'              => $this->body,
			'anchor_type'       => $this->anchor_type,
			'anchor_ref_id'     => $this->anchor_ref_id,
			'offset_minutes'    => $this->offset_minutes,
			'recipients_filter' => wp_json_encode( (array) $this->recipients_filter ),
			'scheduled_for'     => $this->scheduled_for,
			'status'            => $this->status ? $this->status : 'scheduled',
			'sent_count'        => $this->sent_count,
			'failed_count'      => $this->failed_count,
			'skipped_count'     => $this->skipped_count,
			'sent_at'           => $this->sent_at,
			'last_error'        => $this->last_error,
			'created_by'        => $this->created_by,
		);

		$format = array( '%d', '%d', '%s', '%s', '%s', '%d', '%d', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%s', '%d' );

		if ( $this->id ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$result = $wpdb->insert( $table_name, $data, $format );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return false !== $result;
	}

	/**
	 * Delete from database.
	 *
	 * @return bool Success.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_audience_event_scheduled_messages';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
