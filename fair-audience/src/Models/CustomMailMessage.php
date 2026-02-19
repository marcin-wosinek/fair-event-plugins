<?php
/**
 * Custom Mail Message Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Custom mail message model.
 */
class CustomMailMessage {

	/**
	 * Message ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Email subject.
	 *
	 * @var string
	 */
	public $subject;

	/**
	 * Email content (HTML).
	 *
	 * @var string
	 */
	public $content;

	/**
	 * Event date ID (nullable).
	 *
	 * @var int|null
	 */
	public $event_date_id;

	/**
	 * Event post ID.
	 *
	 * @var int|null
	 */
	public $event_id;

	/**
	 * Whether to filter by marketing consent.
	 *
	 * @var bool
	 */
	public $is_marketing;

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
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

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
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id            = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->subject       = isset( $data['subject'] ) ? sanitize_text_field( $data['subject'] ) : '';
		$this->content       = isset( $data['content'] ) ? wp_kses_post( $data['content'] ) : '';
		$this->event_date_id = isset( $data['event_date_id'] ) ? (int) $data['event_date_id'] : null;
		$this->event_id      = isset( $data['event_id'] ) ? (int) $data['event_id'] : null;
		$this->is_marketing  = isset( $data['is_marketing'] ) ? (bool) $data['is_marketing'] : true;
		$this->sent_count    = isset( $data['sent_count'] ) ? (int) $data['sent_count'] : 0;
		$this->failed_count  = isset( $data['failed_count'] ) ? (int) $data['failed_count'] : 0;
		$this->skipped_count = isset( $data['skipped_count'] ) ? (int) $data['skipped_count'] : 0;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_custom_mail_messages';

		if ( empty( $this->subject ) || empty( $this->content ) ) {
			return false;
		}

		$data = array(
			'subject'       => $this->subject,
			'content'       => $this->content,
			'event_date_id' => $this->event_date_id,
			'event_id'      => $this->event_id,
			'is_marketing'  => $this->is_marketing ? 1 : 0,
			'sent_count'    => $this->sent_count,
			'failed_count'  => $this->failed_count,
			'skipped_count' => $this->skipped_count,
		);

		$format = array( '%s', '%s', '%d', '%d', '%d', '%d', '%d', '%d' );

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

		return $result !== false;
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

		$table_name = $wpdb->prefix . 'fair_audience_custom_mail_messages';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
