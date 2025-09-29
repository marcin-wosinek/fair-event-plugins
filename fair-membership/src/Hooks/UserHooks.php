<?php
/**
 * User-related hooks for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Hooks;

use FairMembership\Models\Group;
use FairMembership\Models\Membership;

defined( 'WPINC' ) || die;

/**
 * Handles user-related WordPress hooks
 */
class UserHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'user_new_form', array( $this, 'add_group_selection_field' ) );
		add_action( 'user_register', array( $this, 'handle_user_group_assignment' ) );
		add_action( 'edit_user_profile', array( $this, 'add_group_selection_field_edit' ) );
		add_action( 'show_user_profile', array( $this, 'add_group_selection_field_edit' ) );
		add_action( 'edit_user_profile_update', array( $this, 'handle_user_profile_update' ) );
		add_action( 'personal_options_update', array( $this, 'handle_user_profile_update' ) );
		add_action( 'admin_head-user-new.php', array( $this, 'add_admin_styles' ) );
		add_action( 'admin_head-user-edit.php', array( $this, 'add_admin_styles' ) );
		add_action( 'admin_head-profile.php', array( $this, 'add_admin_styles' ) );
	}

	/**
	 * Add group selection field to new user form
	 *
	 * @param string $type User type (add-new-user or add-existing-user).
	 * @return void
	 */
	public function add_group_selection_field( $type = '' ) {
		// Only show for administrators
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$groups = $this->get_available_groups();

		if ( empty( $groups ) ) {
			return;
		}

		?>
		<h2><?php esc_html_e( 'Fair Membership Groups', 'fair-membership' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="fair_membership_groups"><?php esc_html_e( 'Assign to Groups', 'fair-membership' ); ?></label>
				</th>
				<td>
					<fieldset class="fair-membership-groups">
						<legend class="screen-reader-text">
							<?php esc_html_e( 'Select groups for this user', 'fair-membership' ); ?>
						</legend>
						<?php foreach ( $groups as $group ) : ?>
							<label for="fair_membership_group_<?php echo esc_attr( $group->id ); ?>">
								<input
									type="checkbox"
									name="fair_membership_groups[]"
									id="fair_membership_group_<?php echo esc_attr( $group->id ); ?>"
									value="<?php echo esc_attr( $group->id ); ?>"
								/>
								<?php echo esc_html( $group->name ); ?>
								<?php if ( $group->description ) : ?>
									<br><span class="description"><?php echo esc_html( $group->description ); ?></span>
								<?php endif; ?>
							</label><br>
						<?php endforeach; ?>
					</fieldset>
					<p class="description">
						<?php esc_html_e( 'Select which groups this user should be added to upon creation.', 'fair-membership' ); ?>
					</p>
				</td>
			</tr>
		</table>
		<?php
	}

	/**
	 * Add group selection field to user edit form
	 *
	 * @param WP_User $user User object.
	 * @return void
	 */
	public function add_group_selection_field_edit( $user ) {
		// Only show for administrators
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$groups           = $this->get_available_groups();
		$user_memberships = Membership::get_by_user( $user->ID );
		$user_group_ids   = array_map(
			function ( $membership ) {
				return $membership->group_id;
			},
			$user_memberships
		);

		if ( empty( $groups ) ) {
			return;
		}

		?>
		<h2><?php esc_html_e( 'Fair Membership Groups', 'fair-membership' ); ?></h2>
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="fair_membership_groups"><?php esc_html_e( 'Group Memberships', 'fair-membership' ); ?></label>
				</th>
				<td>
					<fieldset class="fair-membership-groups">
						<legend class="screen-reader-text">
							<?php esc_html_e( 'Select groups for this user', 'fair-membership' ); ?>
						</legend>
						<?php foreach ( $groups as $group ) : ?>
							<?php $is_member = in_array( $group->id, $user_group_ids, true ); ?>
							<label for="fair_membership_group_<?php echo esc_attr( $group->id ); ?>">
								<input
									type="checkbox"
									name="fair_membership_groups[]"
									id="fair_membership_group_<?php echo esc_attr( $group->id ); ?>"
									value="<?php echo esc_attr( $group->id ); ?>"
									<?php checked( $is_member ); ?>
								/>
								<?php echo esc_html( $group->name ); ?>
								<?php if ( $is_member ) : ?>
									<?php
									$membership = $this->get_user_membership( $user->ID, $group->id );
									if ( $membership ) :
										?>
										<span class="description">
											(<?php echo esc_html( ucfirst( $membership->status ) ); ?>,
											<?php esc_html_e( 'since', 'fair-membership' ); ?>
											<?php echo esc_html( mysql2date( get_option( 'date_format' ), $membership->started_at ) ); ?>)
										</span>
									<?php endif; ?>
								<?php endif; ?>
								<?php if ( $group->description ) : ?>
									<br><span class="description"><?php echo esc_html( $group->description ); ?></span>
								<?php endif; ?>
							</label><br>
						<?php endforeach; ?>
					</fieldset>
					<p class="description">
						<?php esc_html_e( 'Check groups to add the user as a member, uncheck to remove membership.', 'fair-membership' ); ?>
					</p>
				</td>
			</tr>
		</table>
		<?php
	}

	/**
	 * Handle group assignment when a new user is registered
	 *
	 * @param int $user_id User ID.
	 * @return void
	 */
	public function handle_user_group_assignment( $user_id ) {
		// Only process if admin is creating the user
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// Verify nonce for security
		if ( ! isset( $_POST['_wpnonce_create-user'] ) || ! wp_verify_nonce( $_POST['_wpnonce_create-user'], 'create-user' ) ) {
			return;
		}

		$selected_groups = isset( $_POST['fair_membership_groups'] ) ? (array) $_POST['fair_membership_groups'] : array();

		foreach ( $selected_groups as $group_id ) {
			$this->add_user_to_group( $user_id, absint( $group_id ) );
		}
	}

	/**
	 * Handle group assignment when user profile is updated
	 *
	 * @param int $user_id User ID.
	 * @return void
	 */
	public function handle_user_profile_update( $user_id ) {
		// Only process if admin is updating
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// Get current memberships
		$current_memberships = Membership::get_by_user( $user_id );
		$current_group_ids   = array_map(
			function ( $membership ) {
				return $membership->group_id;
			},
			$current_memberships
		);

		// Get selected groups from form
		$selected_groups = isset( $_POST['fair_membership_groups'] ) ? array_map( 'absint', (array) $_POST['fair_membership_groups'] ) : array();

		// Add new memberships
		$groups_to_add = array_diff( $selected_groups, $current_group_ids );
		foreach ( $groups_to_add as $group_id ) {
			$this->add_user_to_group( $user_id, $group_id );
		}

		// Remove unchecked memberships
		$groups_to_remove = array_diff( $current_group_ids, $selected_groups );
		foreach ( $groups_to_remove as $group_id ) {
			$this->remove_user_from_group( $user_id, $group_id );
		}
	}

	/**
	 * Add user to a group
	 *
	 * @param int $user_id User ID.
	 * @param int $group_id Group ID.
	 * @return bool True on success, false on failure.
	 */
	private function add_user_to_group( $user_id, $group_id ) {
		// Check if membership already exists
		$existing_membership = Membership::get_by_user_and_group( $user_id, $group_id );
		if ( $existing_membership ) {
			// If inactive, reactivate it
			if ( $existing_membership->status === 'inactive' ) {
				$existing_membership->status   = 'active';
				$existing_membership->ended_at = null;
				return $existing_membership->save();
			}
			return true; // Already active
		}

		// Create new membership
		$membership = new Membership(
			array(
				'user_id'    => $user_id,
				'group_id'   => $group_id,
				'status'     => 'active',
				'started_at' => current_time( 'mysql' ),
			)
		);

		return $membership->save();
	}

	/**
	 * Remove user from a group
	 *
	 * @param int $user_id User ID.
	 * @param int $group_id Group ID.
	 * @return bool True on success, false on failure.
	 */
	private function remove_user_from_group( $user_id, $group_id ) {
		$membership = Membership::get_by_user_and_group( $user_id, $group_id );
		if ( ! $membership ) {
			return true; // Already not a member
		}

		// End the membership instead of deleting it to preserve history
		return $membership->end();
	}

	/**
	 * Get all available groups
	 *
	 * @return array Array of Group objects.
	 */
	private function get_available_groups() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_groups';

		$results = $wpdb->get_results(
			"SELECT * FROM {$table_name} WHERE status = 'active' ORDER BY name ASC",
			ARRAY_A
		);

		return array_map(
			function ( $data ) {
				return new Group( $data );
			},
			$results
		);
	}

	/**
	 * Get specific membership for user and group
	 *
	 * @param int $user_id User ID.
	 * @param int $group_id Group ID.
	 * @return Membership|null Membership object or null.
	 */
	private function get_user_membership( $user_id, $group_id ) {
		return Membership::get_by_user_and_group( $user_id, $group_id );
	}

	/**
	 * Add admin styles for group selection
	 *
	 * @return void
	 */
	public function add_admin_styles() {
		?>
		<style type="text/css">
			.fair-membership-groups fieldset label {
				display: block;
				margin-bottom: 8px;
				padding: 4px 0;
			}
			.fair-membership-groups fieldset label input[type="checkbox"] {
				margin-right: 8px;
			}
			.fair-membership-groups .description {
				color: #646970;
				font-style: italic;
				margin-left: 24px;
			}
		</style>
		<?php
	}
}