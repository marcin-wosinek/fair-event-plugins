<?php
/**
 * Instagram Post Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Instagram post model.
 */
class InstagramPost {

	/**
	 * Post ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Instagram media ID after publishing.
	 *
	 * @var string|null
	 */
	public $ig_media_id;

	/**
	 * Instagram container ID during creation.
	 *
	 * @var string|null
	 */
	public $ig_container_id;

	/**
	 * Post caption.
	 *
	 * @var string
	 */
	public $caption;

	/**
	 * Image URL (must be publicly accessible).
	 *
	 * @var string
	 */
	public $image_url;

	/**
	 * Instagram post permalink URL.
	 *
	 * @var string|null
	 */
	public $permalink;

	/**
	 * Post status: pending, publishing, published, failed.
	 *
	 * @var string
	 */
	public $status;

	/**
	 * Error message if post failed.
	 *
	 * @var string|null
	 */
	public $error_message;

	/**
	 * Created timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Published timestamp.
	 *
	 * @var string|null
	 */
	public $published_at;

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
		$this->id              = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->ig_media_id     = isset( $data['ig_media_id'] ) ? sanitize_text_field( $data['ig_media_id'] ) : null;
		$this->ig_container_id = isset( $data['ig_container_id'] ) ? sanitize_text_field( $data['ig_container_id'] ) : null;
		$this->caption         = isset( $data['caption'] ) ? sanitize_textarea_field( $data['caption'] ) : '';
		$this->image_url       = isset( $data['image_url'] ) ? esc_url_raw( $data['image_url'] ) : '';
		$this->permalink       = isset( $data['permalink'] ) ? esc_url_raw( $data['permalink'] ) : null;
		$this->status          = isset( $data['status'] ) ? $data['status'] : 'pending';
		$this->error_message   = isset( $data['error_message'] ) ? sanitize_textarea_field( $data['error_message'] ) : null;
		$this->created_at      = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->published_at    = isset( $data['published_at'] ) ? $data['published_at'] : null;
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_instagram_posts';

		// Validate required fields.
		if ( empty( $this->caption ) || empty( $this->image_url ) ) {
			return false;
		}

		// Validate status enum.
		if ( ! in_array( $this->status, array( 'pending', 'publishing', 'published', 'failed' ), true ) ) {
			$this->status = 'pending';
		}

		$data = array(
			'ig_media_id'     => $this->ig_media_id,
			'ig_container_id' => $this->ig_container_id,
			'caption'         => $this->caption,
			'image_url'       => $this->image_url,
			'permalink'       => $this->permalink,
			'status'          => $this->status,
			'error_message'   => $this->error_message,
			'published_at'    => $this->published_at,
		);

		$format = array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' );

		if ( $this->id ) {
			// Update existing.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
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

		$table_name = $wpdb->prefix . 'fair_audience_instagram_posts';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
