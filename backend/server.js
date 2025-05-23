const express = require('express');
const connectDB = require('./config/db');
const Policy = require('./models/policy');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const User = require('./models/signup');
const { authenticateToken } = require('../Middleware/authenticateToken'); // Updated path
const UserData = require('./models/userData');
const {authenticate}= require('../Middleware/authenticate');
const {authenticateUser}= require('../Middleware/authenticateUser');
const axios = require('axios');
const { authenticatedToken } = require('../Middleware/authenticatedToken'); // Updated path
const Feedback = require('./models/feedback');
const Article = require('./models/articles');
const Admin = require('./models/admin')


const app = express();
const port = 3000;

// CORS Configuration
app.use(cors({
    origin: 'https://healthsync-21a49.web.app', // Adjust this to your frontend's origin
    credentials: true // Allow credentials (cookies, etc.)
}));
app.use(express.json());
app.use(cookieParser());

// Connect to MongoDB
connectDB();

// Backend route for fetching distinct policy filters
app.get('/api/policies/filters', async (req, res) => {
    try {
        const brandNames = await Policy.distinct("Brand_Name");
        const coverageAmounts = await Policy.distinct("Coverage_Amount");
        res.json({ brandNames, coverageAmounts });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Backend route for fetching policies based on filters
app.get('/api/policies', async (req, res) => {
    const { brandName, coverageAmount } = req.query;
    
    // Build your query based on brand and coverage
    const query = {};
    if (brandName) query.Brand_Name = brandName;
    if (coverageAmount) query.Coverage_Amount = coverageAmount;

    try {
        const policies = await Policy.find(query);
        res.json(policies);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching policies' });
    }
});

// Auth Routes
// **Signup Route**
app.post('/api/auth/signup', async (req, res) => {
    try {
      const { name, email, password } = req.body;
  
      // Check if the user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
      }
  
      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
  
      // Create a new user
      const newUser = new User({
        name,
        email,
        password: hashedPassword,
      });
  
      await newUser.save();
  
      // Generate a JWT token
      const token = jwt.sign(
        { userId: newUser._id },
        process.env.JWT_SECRET || 'My-secret-key'
      );
  
      // Send response with token and user data
      res.status(201).json({
        message: 'User created successfully',
        token,
        user: { id: newUser._id, name: newUser.name, email: newUser.email },
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });


// Login route to authenticate user and set cookie
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // If password is not set, ask to set a new one
    if (user.password=="null") {
      return res.status(403).json({
        message: 'Password not set. Please create a new password.',
        requirePasswordReset: true,
        email: user.email
      });
    }

    // Validate password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'My-secret-key'
    );

    // Set cookie with user data (without password)
    res.cookie('user', JSON.stringify({ id: user._id, name: user.name, email: user.email }), { 
      httpOnly: true, 
    });

    res.json({ token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Profile Route to get user details
app.get('/api/auth/user', authenticateToken, async (req, res) => {
  try {
      const userId = req.user.userId;
      const user = await User.findById(userId).select('-password'); // Exclude the password field

      if (!user) {
          return res.status(404).json({ message: 'User not found' });
      }

      res.json({ user });
  } catch (error) {
      console.error('Error fetching user:', error);
    }
});

// Update user profile
app.patch('/api/auth/user/update', authenticateToken, async (req, res) => {
    try {
        const { name, job, gender, phone, address } = req.body;
        const userId = req.user.userId;

        const updatedUser = await User.findByIdAndUpdate(userId, { name, job, gender, phone, address }, { new: true });

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ user: updatedUser });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Route handler to fetch user data
app.get("/api/user/get-data", authenticateUser, async (req, res) => {
  const userId = req.userId; 

  if (!userId) {
    return res.status(400).json({ message: "User ID is required." });
  }

  try {
    // Fetch user data from the database
    const user = await UserData.findOne({ userId });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Only return health-related data to the client
    const userData = {
      gender: user.gender || "",
      age: user.age || "",
      height: user.height || "",
      weight: user.weight || "",
      salary: user.salary || "",
      diabetes: user.diabetes || false,
      bloodPressureProblems: user.bloodPressureProblems || false,
      anyTransplants: user.anyTransplants || false,
      anyChronicDiseases: user.anyChronicDiseases || false,
      knownAllergies: user.knownAllergies || false,
      historyOfCancerInFamily: user.historyOfCancerInFamily || false,
      numberOfMajorSurgeries: user.numberOfMajorSurgeries || 0,
    };

    res.status(200).json(userData);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ message: "An error occurred while fetching user data." });
  }
});


// Route to handle user data and predict fitness score
app.post('/api/user/update-data', authenticate, async (req, res) => {
  const {
    gender, age, height, weight,salary, 
    diabetes, bloodPressureProblems, anyTransplants,
    anyChronicDiseases, knownAllergies, 
    historyOfCancerInFamily, numberOfMajorSurgeries
  } = req.body;

  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required." });
    }

    // Prepare the data for prediction (only use relevant features for the prediction)
    const predictionData = {
      age: parseInt(age),
      diabetes: diabetes ? 1 : 0,
      bloodPressureProblems: bloodPressureProblems ? 1 : 0,
      anyTransplants: anyTransplants ? 1 : 0,
      anyChronicDiseases: anyChronicDiseases ? 1 : 0,
      height: parseInt(height),
      weight: parseInt(weight),
      knownAllergies: knownAllergies ? 1 : 0,
      historyOfCancerInFamily: historyOfCancerInFamily ? 1 : 0,
      numberOfMajorSurgeries:parseInt(numberOfMajorSurgeries),

    };

    // Make prediction request to the ML model
    const predictionResponse = await axios.post('https://healthsync-ml-65s5.onrender.com/predict', {
      features: Object.values(predictionData)
    });

    const { predicted_fitness_score } = predictionResponse.data;

    if (!predicted_fitness_score) {
      return res.status(500).json({ message: "Failed to retrieve fitness score." });
    }

    const existingUser = await UserData.findOne({ userId });

    // Prepare the full data object (including all form data)
    const fullData = {
      gender,
      age,
      height,
      weight,
      salary,
      diabetes,
      bloodPressureProblems,
      anyTransplants,
      anyChronicDiseases,
      knownAllergies,
      historyOfCancerInFamily,
      numberOfMajorSurgeries,
      fitnessScore:predicted_fitness_score,
      profileCompleted: true,
    };

    if (existingUser) {
      // Update existing user data and add the fitness score
      Object.assign(existingUser, fullData);

      await existingUser.save();
      res.json({ message: "User data updated successfully", user: existingUser });
    } else {
      // Create a new user entry with the fitness score
      const newUser = new UserData({
        userId,
        ...fullData,
      });

      await newUser.save();
      res.json({ message: "User data created successfully", user: newUser });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Server error." });
  }
});


app.get('/api/fitness-data', authenticateUser, async (req, res) => {
  try {
      const userId = req.userId; // From authenticated token

      // Fetch fitness data for the authenticated user
      const userFitnessData = await UserData.findOne({ userId });

      if (!userFitnessData) {
          return res.status(404).json({ message: "No fitness data found for the user." });
      }

      // Send the fitness data as response
      res.json(userFitnessData);
  } catch (error) {
      console.error('Error fetching fitness data:', error);
      res.status(500).json({ message: 'Server error while fetching fitness data.' });
  }
});


app.get('/api/policies/recommendations', authenticatedToken, async (req, res) => {
  try {
    const userId = req.user.userId; // Get the userId from the token

    // Fetch user data to retrieve the fitness score
    const userData = await UserData.findOne({ userId });
    if (!userData) {
      console.log("No user data found for user:", userId); // Log if no data is found
      return res.status(404).json({ message: 'User data not found' });
    }

    const fitnessScore = userData.fitnessScore; // Extract the fitness score from the user data
    const salary = userData.salary;

    // Ensure fitnessScore is a valid number before sending to the model
    if (isNaN(fitnessScore) || fitnessScore < 0 || fitnessScore > 100) {
      console.log("Invalid fitness score:", fitnessScore); // Log invalid score
      return res.status(400).json({ message: 'Invalid fitness score' });
    }

    // Send fitness score to the model to get recommendations
    const predictionResponse = await axios.post('https://healthsync-ml-65s5.onrender.com/recommend', {
      fitness_score: fitnessScore,
      salary:salary // Send the fitness score for model prediction
    });

    const recommendedPolicies = predictionResponse.data.recommendations;

    // If no recommended policies are found, handle gracefully
    if (!recommendedPolicies || recommendedPolicies.length === 0) {
      console.log("No recommendations found."); // Log if no recommendations
      return res.status(404).json({ message: 'No recommendations found' });
    }

    // Return the recommended policies
    res.json(recommendedPolicies);
  } catch (error) {
    console.error('Error fetching recommendations:', error.message); // Log error message
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Insert Feedback
app.post('/submit-feedback', authenticatedToken, async (req, res) => {
  const { feedback, rating } = req.body;
  const userId = req.user.userId;  // Get userId from the authenticated token

  try {
    const existingFeedback = await Feedback.findOne({ userId });

    if (existingFeedback) {
      // Update existing feedback
      existingFeedback.feedback = feedback;
      existingFeedback.rating = rating;
      existingFeedback.updated_at = new Date();

      await existingFeedback.save();
      res.send({ message: 'Feedback updated successfully!', id: existingFeedback._id });
    } else {
      // Create new feedback
      const newFeedback = new Feedback({ userId, feedback, rating });
      const savedFeedback = await newFeedback.save();

      res.send({ message: 'Feedback submitted successfully!', id: savedFeedback._id });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Error processing feedback.' });
  }
});

app.get('/api/articles', async (req, res) => {
  try {
    const articles = await Article.find({}); // Fetch all articles
    res.json(articles); // Send the articles as a JSON response
  } catch (error) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Error fetching articles from the database' });
  }
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Check if the user exists
    const user = await Admin.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Compare the password
    if (user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign({ id: user._id, role: 'admin' }, process.env.JWT_SECRET || 'My-secret-key');

    return res.status(200).json({ message: 'Login successful', token });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error });
  }
});

app.get('/admin/users', async (req, res) => {
  try {
    const users = await User.find({}, 'name email job phone address createdAt'); // Fetch required fields
    res.status(200).json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


app.get('/admin/feedbacks', async (req, res) => {
  try {
    const feedbacks = await Feedback.find({}).populate('userId', 'name email').select('userId feedback rating created_at'); // Populate user info and select required fields
    res.status(200).json(feedbacks);
  } catch (err) {
    console.error('Error fetching feedbacks:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// DELETE /admin/users/:email
app.delete('/admin/users/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const deletedUser = await User.findOneAndDelete({ email });
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /admin/users/:email/reset-password
app.post('/admin/users/:email/reset-password', async (req, res) => {
  const { email } = req.params;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.password = "null"; // or '' depending on your schema validation
    await user.save();

    // Optionally: trigger email with reset link/token here

    res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.post('/user/change-password', async (req, res) => {
  const { email, oldPassword, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const passwordMatch = await bcrypt.compare(oldPassword, user.password);
    if (!passwordMatch) return res.status(401).json({ message: 'Incorrect current password' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/user/set-password', async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hashed = await bcrypt.hash(newPassword, 10);
    user.password = hashed;
    await user.save();

    res.status(200).json({ message: 'Password has been set. You can now login.' });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// Server Listening
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
