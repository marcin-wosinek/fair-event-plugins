<?php
/**
 * PostTeamMember Model
 *
 * @package FairTeam
 */

namespace FairTeam\Models;

defined( 'WPINC' ) || die;

/**
 * Model class for post-team member relationships.
 *
 * Represents a single relationship between a post (event, post, page, etc.)
 * and a team member.
 */
class PostTeamMember {

	/**
	 * Relationship ID.
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Post ID.
	 *
	 * @var int
	 */
	public $post_id;

	/**
	 * Team member post ID.
	 *
	 * @var int
	 */
	public $team_member_id;

	/**
	 * Created at timestamp.
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Updated at timestamp.
	 *
	 * @var string
	 */
	public $updated_at;

	/**
	 * Constructor.
	 *
	 * @param array $data Optional. Data to populate the model.
	 */
	public function __construct( $data = array() ) {
		if ( ! empty( $data ) ) {
			$this->populate( $data );
		}
	}

	/**
	 * Populate model from data array.
	 *
	 * @param array $data Data to populate from.
	 */
	public function populate( $data ) {
		$this->id             = isset( $data['id'] ) ? (int) $data['id'] : null;
		$this->post_id        = isset( $data['post_id'] ) ? (int) $data['post_id'] : 0;
		$this->team_member_id = isset( $data['team_member_id'] ) ? (int) $data['team_member_id'] : 0;
		$this->created_at     = isset( $data['created_at'] ) ? (string) $data['created_at'] : '';
		$this->updated_at     = isset( $data['updated_at'] ) ? (string) $data['updated_at'] : '';
	}

	/**
	 * Save the relationship to the database.
	 *
	 * @return bool True on success, false on failure.
	 */
	public function save() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_team_post_members';

		if ( empty( $this->post_id ) || empty( $this->team_member_id ) ) {
			return false;
		}

		$data = array(
			'post_id'        => $this->post_id,
			'team_member_id' => $this->team_member_id,
		);

		if ( $this->id ) {
			// Update existing relationship.
			$result = $wpdb->update(
				$table_name,
				$data,
				array( 'id' => $this->id ),
				array( '%d', '%d' ),
				array( '%d' )
			);
		} else {
			// Insert new relationship.
			$result = $wpdb->insert( $table_name, $data, array( '%d', '%d' ) );
			if ( $result ) {
				$this->id = $wpdb->insert_id;
			}
		}

		return $result !== false;
	}

	/**
	 * Delete the relationship from the database.
	 *
	 * @return bool True on success, false on failure.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		$table_name = $wpdb->prefix . 'fair_team_post_members';

		return $wpdb->delete(
			$table_name,
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}
}
