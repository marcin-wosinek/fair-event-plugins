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
	 * Category ID (null = all categories).
	 *
	 * @var int|null
	 */
	public $category_id;

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
		$this->id          = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->content     = isset( $data['content'] ) ? wp_kses_post( $data['content'] ) : '';
		$this->is_active   = isset( $data['is_active'] ) ? (bool) $data['is_active'] : true;
		$this->category_id = isset( $data['category_id'] ) && null !== $data['category_id'] ? (int) $data['category_id'] : null;
		$this->created_at  = isset( $data['created_at'] ) ? $data['created_at'] : '';
		$this->updated_at  = isset( $data['updated_at'] ) ? $data['updated_at'] : '';
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
			'content'     => $this->content,
			'is_active'   => $this->is_active ? 1 : 0,
			'category_id' => null !== $this->category_id ? $this->category_id : 0,
		);

		$format = array( '%s', '%d', '%d' );

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

		if ( false === $result ) {
			return false;
		}

		// wpdb format %d converts null to 0, so fix NULL category_id after save.
		if ( null === $this->category_id ) {
			$wpdb->update(
				$table_name,
				array( 'category_id' => null ),
				array( 'id' => $this->id ),
				array( null ),
				array( '%d' )
			);
		}

		return true;
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
