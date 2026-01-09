<?php
/**
 * Poll Option Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * Poll option model.
 */
class PollOption {

	/**
	 * Option ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Poll ID.
	 *
	 * @var int
	 */
	public $poll_id;

	/**
	 * Option text.
	 *
	 * @var string
	 */
	public $option_text;

	/**
	 * Display order.
	 *
	 * @var int
	 */
	public $display_order;

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
		$this->poll_id       = isset( $data['poll_id'] ) ? (int) $data['poll_id'] : 0;
		$this->option_text   = isset( $data['option_text'] ) ? sanitize_text_field( $data['option_text'] ) : '';
		$this->display_order = isset( $data['display_order'] ) ? (int) $data['display_order'] : 0;
		$this->created_at    = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_poll_options';

		// Validate required fields.
		if ( empty( $this->poll_id ) || empty( $this->option_text ) ) {
			return false;
		}

		$data = array(
			'poll_id'       => $this->poll_id,
			'option_text'   => $this->option_text,
			'display_order' => $this->display_order,
		);

		$format = array( '%d', '%s', '%d' );

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

		$table_name = $wpdb->prefix . 'fair_audience_poll_options';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
