<?php
/**
 * Group Form component for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

use FairMembership\Models\Group;

defined( 'WPINC' ) || die;

/**
 * Reusable group form component using WordPress form helpers
 */
class GroupForm {

	/**
	 * Group data
	 *
	 * @var array
	 */
	private $group_data;

	/**
	 * Form mode (add or edit)
	 *
	 * @var string
	 */
	private $mode;

	/**
	 * Constructor
	 *
	 * @param array  $group_data Group data array.
	 * @param string $mode Form mode ('add' or 'edit').
	 */
	public function __construct( $group_data = array(), $mode = 'add' ) {
		$this->group_data = wp_parse_args(
			$group_data,
			array(
				'id'             => 0,
				'name'           => '',
				'description'    => '',
				'access_control' => 'open',
			)
		);
		$this->mode       = $mode;
	}

	/**
	 * Render the form
	 *
	 * @return void
	 */
	public function render() {
		$submit_text = 'add' === $this->mode ? __( 'Add Group', 'fair-membership' ) : __( 'Update Group', 'fair-membership' );
		$action_name = 'add' === $this->mode ? 'fair_membership_add_group' : 'fair_membership_update_group';
		?>
		<form method="post" action="" novalidate="novalidate">
			<?php
			wp_nonce_field( $action_name, 'fair_membership_nonce' );
			if ( 'edit' === $this->mode ) {
				printf( '<input type="hidden" name="group_id" value="%d" />', absint( $this->group_data['id'] ) );
			}
			?>

			<table class="form-table" role="presentation">
				<tbody>
					<?php $this->render_name_field(); ?>
					<?php $this->render_description_field(); ?>
					<?php $this->render_access_control_field(); ?>
					<?php if ( 'edit' === $this->mode ) : ?>
						<?php $this->render_member_count_field(); ?>
					<?php endif; ?>
				</tbody>
			</table>

			<?php submit_button( $submit_text, 'primary', 'submit', true ); ?>
		</form>
		<?php
	}

	/**
	 * Render group name field
	 *
	 * @return void
	 */
	private function render_name_field() {
		?>
		<tr>
			<th scope="row">
				<label for="group_name"><?php esc_html_e( 'Group Name', 'fair-membership' ); ?> <span class="description">(required)</span></label>
			</th>
			<td>
				<input
					name="group_name"
					type="text"
					id="group_name"
					value="<?php echo esc_attr( $this->group_data['name'] ); ?>"
					class="regular-text"
					required
					aria-describedby="group-name-description"
				/>
				<p class="description" id="group-name-description">
					<?php esc_html_e( 'Enter a unique name for this group.', 'fair-membership' ); ?>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render group description field
	 *
	 * @return void
	 */
	private function render_description_field() {
		?>
		<tr>
			<th scope="row">
				<label for="group_description"><?php esc_html_e( 'Description', 'fair-membership' ); ?></label>
			</th>
			<td>
				<textarea
					name="group_description"
					id="group_description"
					rows="4"
					cols="50"
					class="large-text"
					aria-describedby="group-description-description"
				><?php echo esc_textarea( $this->group_data['description'] ); ?></textarea>
				<p class="description" id="group-description-description">
					<?php esc_html_e( 'Provide a description for this group (optional).', 'fair-membership' ); ?>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render member count field (read-only for edit mode)
	 *
	 * @return void
	 */
	private function render_member_count_field() {
		if ( 'edit' !== $this->mode ) {
			return;
		}
		?>
		<tr>
			<th scope="row">
				<?php esc_html_e( 'Members', 'fair-membership' ); ?>
			</th>
			<td>
				<strong><?php echo esc_html( $this->group_data['members'] ?? 0 ); ?></strong>
				<?php esc_html_e( 'members', 'fair-membership' ); ?>
				<p class="description">
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-members&group=' . $this->group_data['id'] ) ); ?>">
						<?php esc_html_e( 'Manage members', 'fair-membership' ); ?>
					</a>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render access control field
	 *
	 * @return void
	 */
	private function render_access_control_field() {
		?>
		<tr>
			<th scope="row">
				<label for="access_control"><?php esc_html_e( 'Access Control', 'fair-membership' ); ?></label>
			</th>
			<td>
				<fieldset>
					<legend class="screen-reader-text">
						<?php esc_html_e( 'Group Access Control', 'fair-membership' ); ?>
					</legend>
					<label for="access_control_open">
						<input
							type="radio"
							name="access_control"
							id="access_control_open"
							value="open"
							<?php checked( $this->group_data['access_control'], 'open' ); ?>
							aria-describedby="access-control-open-description"
						/>
						<?php esc_html_e( 'Open', 'fair-membership' ); ?>
					</label>
					<p class="description" id="access-control-open-description">
						<?php esc_html_e( 'Users can join this group themselves.', 'fair-membership' ); ?>
					</p>

					<label for="access_control_managed">
						<input
							type="radio"
							name="access_control"
							id="access_control_managed"
							value="managed"
							<?php checked( $this->group_data['access_control'], 'managed' ); ?>
							aria-describedby="access-control-managed-description"
						/>
						<?php esc_html_e( 'Managed', 'fair-membership' ); ?>
					</label>
					<p class="description" id="access-control-managed-description">
						<?php esc_html_e( 'Only administrators can add or remove members.', 'fair-membership' ); ?>
					</p>
				</fieldset>
			</td>
		</tr>
		<?php
	}


	/**
	 * Process form submission
	 *
	 * @return array|false Array with success message or false on failure.
	 */
	public function process_submission() {
		// Verify nonce
		if ( ! isset( $_POST['fair_membership_nonce'] ) ) {
			return false;
		}

		$action_name = 'add' === $this->mode ? 'fair_membership_add_group' : 'fair_membership_update_group';

		if ( ! wp_verify_nonce( $_POST['fair_membership_nonce'], $action_name ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-membership' ) );
		}

		// Sanitize and validate data
		$group_data = $this->sanitize_form_data();

		if ( ! $group_data ) {
			return false;
		}

		// Process based on mode
		if ( 'add' === $this->mode ) {
			return $this->add_group( $group_data );
		} else {
			return $this->update_group( $group_data );
		}
	}

	/**
	 * Sanitize form data
	 *
	 * @return array|false Sanitized data or false on validation failure.
	 */
	private function sanitize_form_data() {
		$errors = array();

		// Group name is required
		$name = isset( $_POST['group_name'] ) ? sanitize_text_field( $_POST['group_name'] ) : '';
		if ( empty( $name ) ) {
			$errors[] = __( 'Group name is required.', 'fair-membership' );
		}

		// Description is optional
		$description = isset( $_POST['group_description'] ) ? sanitize_textarea_field( $_POST['group_description'] ) : '';

		// Access control
		$access_control        = isset( $_POST['access_control'] ) ? sanitize_text_field( $_POST['access_control'] ) : 'open';
		$valid_access_controls = array( 'open', 'managed' );
		if ( ! in_array( $access_control, $valid_access_controls, true ) ) {
			$access_control = 'open'; // Default fallback
		}

		if ( ! empty( $errors ) ) {
			// Store errors for display
			set_transient( 'fair_membership_form_errors', $errors, 300 );
			return false;
		}

		$data = array(
			'name'           => $name,
			'description'    => $description,
			'access_control' => $access_control,
		);

		if ( 'edit' === $this->mode && isset( $_POST['group_id'] ) ) {
			$data['id'] = absint( $_POST['group_id'] );
		}

		return $data;
	}

	/**
	 * Add new group
	 *
	 * @param array $group_data Group data.
	 * @return array Success result.
	 */
	private function add_group( $group_data ) {
		// Create Group model instance
		$group                 = new Group();
		$group->name           = $group_data['name'];
		$group->description    = $group_data['description'];
		$group->access_control = $group_data['access_control'];
		$group->status         = 'active';
		$group->created_by     = get_current_user_id();

		// Generate slug from name
		$group->slug = $this->generate_slug( $group->name );

		// Validate data
		$validation_errors = $group->validate();
		if ( ! empty( $validation_errors ) ) {
			set_transient( 'fair_membership_form_errors', $validation_errors, 300 );
			return false;
		}

		// Save to database
		$result = $group->save();

		if ( $result ) {
			return array(
				'success'  => true,
				'message'  => __( 'Group added successfully.', 'fair-membership' ),
				'redirect' => admin_url( 'admin.php?page=fair-membership&added=1' ),
			);
		} else {
			set_transient( 'fair_membership_form_errors', array( __( 'Failed to save group. Please try again.', 'fair-membership' ) ), 300 );
			return false;
		}
	}

	/**
	 * Update existing group
	 *
	 * @param array $group_data Group data.
	 * @return array Success result.
	 */
	private function update_group( $group_data ) {
		// Get existing group
		$group = Group::get_by_id( $group_data['id'] );

		if ( ! $group ) {
			set_transient( 'fair_membership_form_errors', array( __( 'Group not found.', 'fair-membership' ) ), 300 );
			return false;
		}

		// Update properties
		$group->name           = $group_data['name'];
		$group->description    = $group_data['description'];
		$group->access_control = $group_data['access_control'];

		// Update slug if name changed
		if ( $this->generate_slug( $group->name ) !== $group->slug ) {
			$group->slug = $this->generate_slug( $group->name );
		}

		// Validate data
		$validation_errors = $group->validate();
		if ( ! empty( $validation_errors ) ) {
			set_transient( 'fair_membership_form_errors', $validation_errors, 300 );
			return false;
		}

		// Save to database
		$result = $group->save();

		if ( $result ) {
			return array(
				'success'  => true,
				'message'  => __( 'Group updated successfully.', 'fair-membership' ),
				'redirect' => admin_url( 'admin.php?page=fair-membership-group-view&id=' . $group_data['id'] . '&updated=1' ),
			);
		} else {
			set_transient( 'fair_membership_form_errors', array( __( 'Failed to update group. Please try again.', 'fair-membership' ) ), 300 );
			return false;
		}
	}


	/**
	 * Generate a unique slug from group name
	 *
	 * @param string $name Group name.
	 * @return string Unique slug.
	 */
	private function generate_slug( $name ) {
		$slug = sanitize_title( $name );

		// Ensure uniqueness
		$original_slug = $slug;
		$counter       = 1;

		while ( Group::get_by_slug( $slug ) ) {
			$slug = $original_slug . '-' . $counter;
			++$counter;
		}

		return $slug;
	}

	/**
	 * Display form errors if any
	 *
	 * @return void
	 */
	public static function display_errors() {
		$errors = get_transient( 'fair_membership_form_errors' );
		if ( $errors ) {
			delete_transient( 'fair_membership_form_errors' );
			?>
			<div class="notice notice-error">
				<p><strong><?php esc_html_e( 'Please correct the following errors:', 'fair-membership' ); ?></strong></p>
				<ul>
					<?php foreach ( $errors as $error ) : ?>
						<li><?php echo esc_html( $error ); ?></li>
					<?php endforeach; ?>
				</ul>
			</div>
			<?php
		}
	}
}