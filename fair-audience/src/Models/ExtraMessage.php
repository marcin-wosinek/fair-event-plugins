<?php
/**
 * Extra Message Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Extra message model.
 */
class ExtraMessage {

	/**
	 * Message ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Message content.
	 *
	 * @var string
	 */
	public $content;

	/**
	 * Whether the message is active.
	 *
	 * @var bool
	 */
	public $is_active;

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
	 * Populate from data array.
	 *
	 * @param array $data Data array.
	 */
	public function populate( $data ) {
		$this->id         = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->content    = isset( $data['content'] ) ? wp_kses_post( $data['content'] ) : '';
		$this->is_active  = isset( $data['is_active'] ) ? (bool) $data['is_active'] : true;
		$this->created_at = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_extra_messages';

		// Validate required fields.
		if ( empty( $this->content ) ) {
			return false;
		}

		$data = array(
			'content'   => $this->content,
			'is_active' => $this->is_active ? 1 : 0,
		);

		$format = array( '%s', '%d' );

		if ( $this->id ) {
			// Update existing.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				$format,
				array( '%d' )
			);
		} else {
			// Insert new.
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

		$table_name = $wpdb->prefix . 'fair_audience_extra_messages';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
