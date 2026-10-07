#include <iostream>
#include <fstream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <cmath>
#include <unistd.h>

using namespace std;

// OOP Unit 2: Fundamentals of Operator Overloading

struct Vector3 {
    double x, y, z;
    Vector3() { x = 0; y = 0; z = 0; }
    Vector3(double a, double b, double c) { x = a; y = b; z = c; }
    Vector3 operator+(const Vector3 &o) const { 
        return Vector3(x + o.x, y + o.y, z + o.z); 
    } Vector3 operator-(const Vector3 &o) const { 
        return Vector3(x - o.x, y - o.y, z - o.z); 
    } Vector3 operator*(double s) const { 
        return Vector3(x * s, y * s, z * s); 
    }
};

inline double dist3D(Vector3 a, Vector3 b) {
    double dx = a.x - b.x;
    double dy = a.y - b.y;
    double dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

#include "Queues_DSA.h"
#include "AVL_Tree.h"
#include "Satellites_OOP.h"
#include "FlightComputer.h"
#include "Chaos_Engine.h"