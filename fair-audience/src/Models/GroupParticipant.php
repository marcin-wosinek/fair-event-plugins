<?php
/**
 * GroupParticipant Model
 *
 * @package FairAudience
 */

namespace FairAudience\Models;

defined( 'WPINC' ) || die;

/**
 * GroupParticipant model for junction table.
 */
class GroupParticipant {

	/**
	 * Junction record ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Group ID.
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * Participant ID.
	 *
	 * @var int
	 */
	public $participant_id;

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
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->group_id       = isset( $data['group_id'] ) ? (int) $data['group_id'] : 0;
		$this->participant_id = isset( $data['participant_id'] ) ? (int) $data['participant_id'] : 0;
		$this->created_at     = isset( $data['created_at'] ) ? $data['created_at'] : '';
	}

	/**
	 * Save to database.
	 *
	 * @return bool Success.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_audience_group_participants';

		if ( empty( $this->group_id ) || empty( $this->participant_id ) ) {
			return false;
		}

		$data = array(
			'group_id'       => $this->group_id,
			'participant_id' => $this->participant_id,
		);

		$format = array( '%d', '%d' );

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

		$table_name = $wpdb->prefix . 'fair_audience_group_participants';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
